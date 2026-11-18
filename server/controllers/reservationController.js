import mongoose from 'mongoose';
import joi from 'joi';
import { Reservation } from '../models/Reservation.js';
import { Item } from '../models/Item.js';
import { User } from '../models/User.js';
import { Payment } from '../models/Payment.js';
import { Notification } from '../models/Notification.js';

const RESERVATION_ID_PATTERN = /^RES-[0-9a-f]{8}$/;

const listMyReservationsSchema = joi.object({
    status: joi.string().valid('pending', 'upcoming', 'active', 'completed', 'cancelled', 'rejected'),
    view: joi.string().valid('upcoming', 'past'),
    from: joi.date().iso(),
    to: joi.date().iso().min(joi.ref('from'))
});

function canViewDelivery(user, reservation) {
    if (user.role === 'admin') return true;
    return reservation.borrower === user.id;
}

function buildReservationFilter(userId, query) {
    const filter = { borrower: userId };

    if (query.status) {
        filter.status = query.status;
    } else if (query.view === 'upcoming') {
        filter.status = { $in: ['pending', 'upcoming', 'active'] };
    } else if (query.view === 'past') {
        filter.status = { $in: ['completed', 'cancelled', 'rejected'] };
    }

    if (query.from) filter.endDate = { $gte: query.from };
    if (query.to) filter.startDate = { $lte: query.to };

    return filter;
}

function calculateCancellationRefund(reservation, item, now = new Date()) {
    const deposit = reservation.payment?.depositAmount ?? 0;
    const freeDays = item?.cancellation?.freeDays ?? 0;
    const forfeitPercent = item?.cancellation?.forfeitPercent ?? 0;

    if (freeDays <= 0 || forfeitPercent <= 0) {
        return { refundAmount: deposit, forfeitAmount: 0 };
    }

    const msUntilStart = new Date(reservation.startDate).getTime() - now.getTime();
    const daysUntilStart = msUntilStart / (1000 * 60 * 60 * 24);

    if (daysUntilStart >= freeDays) {
        return { refundAmount: deposit, forfeitAmount: 0 };
    }

    const forfeitAmount = Math.round((deposit * forfeitPercent) / 100);
    return { refundAmount: Math.max(0, deposit - forfeitAmount), forfeitAmount };
}

// GET /api/reservations
export async function getMyReservations(req, res, next) {
    try {
        const { value, error } = listMyReservationsSchema.validate(req.query ?? {});
        if (error) return res.status(400).json({ message: error.message });

        const filter = buildReservationFilter(req.user.id, value);
        const reservations = await Reservation.find(filter)
            .sort({ startDate: -1, _id: 1 })
            .populate('item', 'name category photos depositAmount pickup')
            .lean();

        return res.status(200).json({ reservations });
    } catch (error) {
        next(error);
    }
}

// PATCH /api/reservations/:reservationId/cancel
export async function cancelReservation(req, res, next) {
    let session;
    try {
        const { reservationId } = req.params;
        if (!RESERVATION_ID_PATTERN.test(reservationId)) {
            return res.status(400).json({ message: 'Invalid reservation id' });
        }

        const reservation = await Reservation.findById(reservationId);
        if (!reservation) return res.status(404).json({ message: 'Reservation not found' });
        if (reservation.borrower !== req.user.id) {
            return res.status(403).json({ message: 'You can only cancel your own reservations' });
        }
        if (!['pending', 'upcoming'].includes(reservation.status)) {
            return res.status(409).json({ message: 'Only pending or upcoming reservations can be cancelled' });
        }
        if (new Date() >= new Date(reservation.startDate)) {
            return res.status(409).json({ message: 'Cannot cancel a reservation on or after the pickup date' });
        }

        const item = await Item.findById(reservation.item).lean();
        const { refundAmount } = calculateCancellationRefund(reservation, item);
        let updated = null;

        session = await mongoose.startSession();
        await session.withTransaction(async () => {
            updated = await Reservation.findOneAndUpdate(
                { _id: reservation._id, status: { $in: ['pending', 'upcoming'] } },
                { $set: { status: 'cancelled' } },
                { new: true, session }
            );
            if (!updated) return;

            if (refundAmount > 0) {
                await User.updateOne({ _id: reservation.borrower }, { $inc: { wallet: refundAmount } }, { session });
                await Payment.create([{
                    user: reservation.borrower,
                    reservation: reservation._id,
                    type: 'deposit-refund',
                    amount: refundAmount,
                    direction: 'receive',
                    method: 'wallet',
                    description: `Deposit refund for cancelled reservation ${reservation._id}`
                }], { session });
            }

            await Notification.create([{
                username: reservation.lender,
                reservation: reservation._id,
                type: 'rejected',
                message: `Reservation ${reservation._id} was cancelled by the borrower.`
            }], { session });
        });

        if (!updated) {
            return res.status(409).json({ message: 'Only pending or upcoming reservations can be cancelled' });
        }

        return res.status(200).json({ reservation: updated, refunded: refundAmount });
    } catch (error) {
        next(error);
    } finally {
        await session?.endSession();
    }
}

export async function getDeliveryStatus(req, res, next) {
    try {
        const { reservationId } = req.params;
        if (!RESERVATION_ID_PATTERN.test(reservationId)) {
            return res.status(400).json({ message: 'Invalid reservation id' });
        }

        const reservation = await Reservation.findById(reservationId).lean();
        if (!reservation) {
            return res.status(404).json({ message: 'Reservation not found' });
        }
        if (!canViewDelivery(req.user, reservation)) {
            return res.status(404).json({ message: 'Reservation not found' });
        }

        if (!reservation.delivery || Object.keys(reservation.delivery).length === 0) {
            return res.status(404).json({ message: 'No delivery data' });
        }

        return res.status(200).json(reservation.delivery);
    } catch (error) {
        next(error);
    }
}