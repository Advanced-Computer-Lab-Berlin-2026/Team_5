import mongoose from 'mongoose';
import joi from 'joi';
import { Reservation } from '../models/Reservation.js';
import { Item } from '../models/Item.js';
import { User } from '../models/User.js';
import { Payment } from '../models/Payment.js';
import { Notification } from '../models/Notification.js';
import { notifyDeliveryStatus } from '../services/notificationService.js';

const RESERVATION_ID_PATTERN = /^RES-[0-9a-f]{8}$/;
const DELIVERY_STATUSES = ['preparing', 'out-for-delivery', 'delivered'];
const updateDeliverySchema = joi.object({
    status: joi.string().valid(...DELIVERY_STATUSES).required()
});

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

function getCancellationPolicy(item) {
    return item?.cancellation ?? { freeDays: 0, forfeitPercent: 0 };
}

function calculateCancellationRefund(reservation, item) {
    const deposit = reservation.payment?.depositAmount ?? 0;
    const { freeDays, forfeitPercent } = getCancellationPolicy(item);
    const daysUntilStart = (new Date(reservation.startDate).getTime() - Date.now()) / 86400000;

    if (freeDays <= 0 || forfeitPercent <= 0 || daysUntilStart >= freeDays) {
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

function canUpdateDelivery(user, reservation) {
    return user.role === 'admin' || reservation.lender === user.id;
}

export async function updateDeliveryStatus(req, res, next) {
    try {
        const { reservationId } = req.params;

        if (!RESERVATION_ID_PATTERN.test(reservationId)) {
            return res.status(400).json({ message: 'Invalid reservation id' });
        }

        const { value, error } = updateDeliverySchema.validate(req.body ?? {}, {
            stripUnknown: true
        });
        if (error) {
            return res.status(400).json({ message: error.message });
        }

        const reservation = await Reservation.findById(reservationId).lean();
        if (!reservation) {
            return res.status(404).json({ message: 'Reservation not found' });
        }
        if (!canUpdateDelivery(req.user, reservation)) {
            return res.status(403).json({ message: 'Forbidden' });
        }

        const updatedReservation = await Reservation.findByIdAndUpdate(
            reservationId,
            { $set: { 'delivery.status': value.status } },
            { new: true, runValidators: true }
        ).lean();

        if (!updatedReservation) {
            return res.status(404).json({ message: 'Reservation not found' });
        }

        if (
            reservation.delivery?.status !== value.status &&
            ['out-for-delivery', 'delivered'].includes(value.status)
        ) {
            await notifyDeliveryStatus(reservation, value.status);
        }

        return res.status(200).json({
            message: `Updated status to ${value.status}`
        });
    } catch (error) {
        next(error);
    }
}

function parseReservationInput({ itemId, startDate, endDate, deliveryFlag, deliveryAddress }) {
    if (!itemId || !startDate || !endDate || (deliveryFlag && !deliveryAddress)) {
        return { error: 'Missing required fields' };
    }

    if (!/^ITM-[0-9a-f]{8}$/.test(itemId)) {
        return { error: 'Invalid item id format' };
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return { error: 'Invalid date format' };
    }

    if (start >= end) {
        return { error: 'Start date must be before end date' };
    }

    return { start, end };
}

function validateReservationItem(item, borrowerId, deliveryFlag, requestedDuration) {
    if (item.owner.toString() === borrowerId) {
        return 'Cannot reserve your own item';
    }

    if (deliveryFlag && !item.delivery.offered) {
        return 'Item does not allow delivery';
    }

    const maxReservationDuration = item.borrowingRules.maxDurationDays || 30; // default to 30 days if not set

    if (requestedDuration > maxReservationDuration) {
        return `Reservation duration exceeds maximum allowed of ${maxReservationDuration} days`;
    }
}

export async function createReservation(req, res, next) {
    try {
        const { itemId, deliveryFlag, deliveryAddress } = req.body;

        const { start, end, error } = parseReservationInput(req.body);
        if (error) {
            return res.status(400).json({ message: error });
        }

        //load item and check if it exists and is not archived or flagged
        const item = await Item.findOne({ _id: itemId, archived: false, flagged: { $ne: true } });
        if (!item) {
            return res.status(404).json({ message: 'Item not found or unavailable' });
        }

        const durationDays = (end - start) / (1000 * 60 * 60 * 24);
        const itemError = validateReservationItem(item, req.user.id, deliveryFlag, durationDays);
        if (itemError) {
            return res.status(400).json({ message: itemError });
        }

        const borrower = await User.findById(req.user.id);
        if (!borrower) {
            return res.status(404).json({ message: 'Borrower not found' });
        }

        const borrowerTrustScore = borrower.trustScore || 0;
        const requiredTrustScore = item.borrowingRules.minTrustScore || 0;

        if (borrowerTrustScore < requiredTrustScore) {
            return res.status(403).json({ message: 'Borrower does not meet the minimum trust score requirement for this item' });
        }

        // item owner is the lender, check if they are suspended
        const lender = await User.findById(item.owner);
        if (!lender) {
            return res.status(404).json({ message: 'Lender not found' });
        }

        if (lender.suspended) {
            return res.status(403).json({ message: 'Lender is suspended, cannot create reservation' });
        }

        // check if item startdate is in the past
        const now = new Date();
        if (start < now) {
            return res.status(400).json({ message: 'Start date cannot be in the past' });
        }

        let conflict = false;
        let reservation;

        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                conflict = false;

                // write to item and reservation in a transaction to ensure consistency
                await Item.updateOne({ _id: itemId }, { $set: { updatedAt: new Date() } }, { session });

                // Check for overlapping reservations
                const overlappingReservation = await Reservation.findOverlap(itemId, start, end, session);
                if (overlappingReservation) {
                    conflict = true;
                    return;
                }

                // Create the reservation
                reservation = new Reservation({
                    item: itemId,
                    borrower: req.user.id,
                    lender: item.owner,
                    payment: {
                        depositAmount: item.depositAmount || 0,
                        method: 'wallet', // default to wallet, can be changed later
                    },
                    startDate: start,
                    endDate: end,
                    delivery: deliveryFlag ? { address: deliveryAddress, fee: item.delivery.fee || 0 } : undefined,
                });

                await reservation.save({ session });
            });
        } finally {
            await session.endSession();
        }

        if (conflict) {
            return res.status(409).json({ message: 'Item is already reserved for the selected dates' });
        }

        return res.status(201).json({ message: 'Reservation created successfully', reservationId: reservation._id });
    } catch (error) {
        next(error);
    }
}