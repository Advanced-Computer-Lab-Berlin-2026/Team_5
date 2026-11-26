import mongoose from 'mongoose';
import joi from 'joi';
import { Reservation } from '../models/Reservation.js';
import { User } from '../models/User.js';
import { Payment } from '../models/Payment.js';
import { DamageReport } from '../models/DamageReport.js';
import { uploadPhotos, deletePhotos } from '../services/photoUpload.js';
import { MAX_PHOTOS } from '../middleware/uploadItemPhotos.js';
import { notify, notifyWishlistItemAvailable } from '../services/notificationService.js';

// Finds the reservation and checks that it belongs to this lender and has one of the allowed statuses.
// Returns { reservation } or { status, message } for the error response.
async function findLenderReservation(id, lenderId, allowedStatuses, action) {
    const reservation = await Reservation.findById(id);
    if (!reservation) return { status: 404, message: 'Reservation not found' };
    if (reservation.lender !== lenderId) return { status: 403, message: 'You do not have permission to update this reservation' };
    if (!allowedStatuses.includes(reservation.status)) {
        return { status: 409, message: `Only ${allowedStatuses.join(' or ')} reservations can ${action}` };
    }
    return { reservation };
}

// after commit so a failed notify never rolls back pickup/return, and prefs/email can run
async function notifyAfterCommit(label, about, work) {
    try {
        await work();
    } catch (error) {
        console.error(`failed to ${label} for ${about}`, error);
    }
}

// PATCH /api/lender/reservations/:id/pickup
export async function markPickedUp(req, res, next) {
    try {
        const { reservation, status, message } = await findLenderReservation(req.params.id, req.user.id, ['upcoming'], 'be marked as picked up');
        if (!reservation) return res.status(status).json({ message });

        reservation.status = 'active';
        // set only this field, so pickup photos added before the handover are kept
        reservation.handover.pickedUpAt = new Date();
        await reservation.save();

        await notifyAfterCommit('notify pickup', reservation._id, () => notify(reservation.borrower, {
            type: 'other',
            subject: 'Item picked up',
            reservation: reservation._id,
            message: 'Your lender marked the item as picked up. Enjoy!',
        }));

        res.status(200).json({ reservation });
    } catch (error) {
        next(error);
    }
}

// PATCH /api/lender/reservations/:id/return
// Marks the item as returned in good condition and refunds the deposit to the borrower's wallet.
export async function markReturnedGood(req, res, next) {
    let session;
    try {
        const { reservation, status, message } = await findLenderReservation(req.params.id, req.user.id, ['active'], 'be marked as returned');
        if (!reservation) return res.status(status).json({ message });

        const refund = reservation.payment.depositAmount;
        let updated = null;

        session = await mongoose.startSession();
        await session.withTransaction(async () => {
            // the status filter stops a second click from refunding twice
            updated = await Reservation.findOneAndUpdate(
                { _id: reservation._id, status: 'active' },
                { $set: { status: 'completed', 'handover.returnedAt': new Date(), 'handover.returnCondition': 'good' } },
                { new: true, session }
            );
            if (!updated) return;

            await User.updateOne({ _id: reservation.borrower }, { $inc: { wallet: refund } }, { session });
            // create() needs an array when options like { session } are passed
            await Payment.create([{
                user: reservation.borrower,
                reservation: reservation._id,
                type: 'deposit-refund',
                amount: refund,
                direction: 'receive',
                method: 'wallet',
                description: `Deposit returned for reservation ${reservation._id}`,
            }], { session });
        });

        if (!updated) return res.status(409).json({ message: 'Only active reservations can be marked as returned' });

        await notifyAfterCommit('notify good return', reservation._id, async () => {
            await notify(reservation.borrower, {
                type: 'other',
                subject: 'Item returned',
                reservation: reservation._id,
                message: `The item was returned in good condition. Your deposit of ${refund} was added to your wallet.`,
            });
            // item is available again for wishlisters (357)
            await notifyWishlistItemAvailable(reservation.item);
        });

        res.status(200).json({ reservation: updated, refunded: refund });
    } catch (error) {
        next(error);
    } finally {
        await session?.endSession();
    }
}

// which reservation statuses allow photos for each stage, and where they are stored
const PHOTO_STAGES = {
    pickup: { statuses: ['upcoming', 'active'], field: 'pickupPhotos' },
    return: { statuses: ['active', 'completed'], field: 'returnPhotos' },
};

// POST /api/lender/reservations/:id/photos/:stage   (stage = pickup | return, form field "photos")
export async function addConditionPhotos(req, res, next) {
    let uploaded = [];
    try {
        const stage = PHOTO_STAGES[req.params.stage];
        if (!stage) return res.status(400).json({ message: 'Stage must be "pickup" or "return"' });
        if (!req.files?.length) return res.status(400).json({ message: 'Please choose at least one photo to upload' });

        const { reservation, status, message } = await findLenderReservation(
            req.params.id, req.user.id, stage.statuses, `get ${req.params.stage} photos`
        );
        if (!reservation) return res.status(status).json({ message });

        const photos = reservation.handover[stage.field];
        if (photos.length + req.files.length > MAX_PHOTOS) {
            return res.status(400).json({ message: `A reservation can have at most ${MAX_PHOTOS} ${req.params.stage} photos` });
        }

        uploaded = await uploadPhotos(req.files);
        photos.push(...uploaded.map((file) => ({ url: file.secure_url })));
        await reservation.save();

        res.status(200).json({ reservation });
    } catch (error) {
        await deletePhotos(uploaded);
        next(error);
    }
}

const damageSchema = joi.object({
    returnCondition: joi.string().trim().required(), // short description, e.g. "Lens is scratched"
    message: joi.string().trim().required(),
});

// POST /api/lender/reservations/:id/damage   (form fields: returnCondition, message, and optional files in "photos")
// Marks the item as returned damaged and opens a damage report. The deposit stays held.
// The return photos are the evidence: new photos are added to them, and the report gets all of them.
export async function reportDamage(req, res, next) {
    let uploaded = [];
    let session;
    try {
        const { value, error } = damageSchema.validate(req.body ?? {}, { stripUnknown: true });
        if (error) return res.status(400).json({ message: error.message });

        const { reservation, status, message } = await findLenderReservation(
            req.params.id, req.user.id, ['active'], 'be reported as damaged'
        );
        if (!reservation) return res.status(status).json({ message });

        const newFiles = req.files ?? [];
        const photoCount = reservation.handover.returnPhotos.length + newFiles.length;
        if (photoCount === 0) return res.status(400).json({ message: 'Please add at least one photo of the damage' });
        if (photoCount > MAX_PHOTOS) {
            return res.status(400).json({ message: `A reservation can have at most ${MAX_PHOTOS} return photos` });
        }

        uploaded = await uploadPhotos(newFiles);
        const newPhotos = uploaded.map((file) => ({ url: file.secure_url }));
        let report = null;

        session = await mongoose.startSession();
        await session.withTransaction(async () => {
            // the status filter stops a second click from opening two reports
            const updated = await Reservation.findOneAndUpdate(
                { _id: reservation._id, status: 'active' },
                {
                    $set: { status: 'completed', 'handover.returnedAt': new Date(), 'handover.returnCondition': 'damaged' },
                    $push: { 'handover.returnPhotos': { $each: newPhotos } },
                },
                { new: true, session }
            );
            if (!updated) return;

            [report] = await DamageReport.create([{
                reservation: reservation._id,
                type: 'report',
                returnCondition: value.returnCondition,
                report: {
                    photos: updated.handover.returnPhotos.map((photo) => ({ url: photo.url })),
                    message: value.message,
                },
            }], { session });
        });

        if (!report) {
            await deletePhotos(uploaded);
            return res.status(409).json({ message: 'Only active reservations can be reported as damaged' });
        }

        await notifyAfterCommit('notify damage return', reservation._id, async () => {
            await notify(reservation.borrower, {
                type: 'other',
                subject: 'Damage reported',
                reservation: reservation._id,
                message: 'Your lender reported the returned item as damaged. Your deposit is held until the report is resolved.',
            });
            // item is available again for wishlisters (358)
            await notifyWishlistItemAvailable(reservation.item);
        });

        res.status(201).json({ report });
    } catch (error) {
        await deletePhotos(uploaded);
        next(error);
    } finally {
        await session?.endSession();
    }
}
