import mongoose from 'mongoose';
import { Reservation } from '../models/Reservation.js';
import { User } from '../models/User.js';
import { Payment } from '../models/Payment.js';
import { Notification } from '../models/Notification.js';

// Finds the reservation and checks that it belongs to this lender and has the expected status.
// Returns { reservation } or { status, message } for the error response.
async function findLenderReservation(id, lenderId, expectedStatus, action) {
    const reservation = await Reservation.findById(id);
    if (!reservation) return { status: 404, message: 'Reservation not found' };
    if (reservation.lender !== lenderId) return { status: 403, message: 'You do not have permission to update this reservation' };
    if (reservation.status !== expectedStatus) {
        return { status: 409, message: `Only ${expectedStatus} reservations can be marked as ${action}` };
    }
    return { reservation };
}

// PATCH /api/lender/reservations/:id/pickup
export async function markPickedUp(req, res, next) {
    try {
        const { reservation, status, message } = await findLenderReservation(req.params.id, req.user.id, 'upcoming', 'picked up');
        if (!reservation) return res.status(status).json({ message });

        reservation.status = 'active';
        reservation.handover = { pickedUpAt: new Date() }; // returnedAt is always empty at pickup
        await reservation.save();

        await Notification.create({
            username: reservation.borrower,
            reservation: reservation._id,
            type: 'other',
            message: 'Your lender marked the item as picked up. Enjoy!',
        });

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
        const { reservation, status, message } = await findLenderReservation(req.params.id, req.user.id, 'active', 'returned');
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
            await Notification.create([{
                username: reservation.borrower,
                reservation: reservation._id,
                type: 'other',
                message: `The item was returned in good condition. Your deposit of ${refund} was added to your wallet.`,
            }], { session });
        });

        if (!updated) return res.status(409).json({ message: 'Only active reservations can be marked as returned' });
        res.status(200).json({ reservation: updated, refunded: refund });
    } catch (error) {
        next(error);
    } finally {
        await session?.endSession();
    }
}
