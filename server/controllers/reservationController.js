import mongoose from 'mongoose';
import joi from 'joi';
import { Reservation } from '../models/Reservation.js';
import { Item } from '../models/Item.js';
import { Payment } from '../models/Payment.js';
import { User } from '../models/User.js';
import { notifyDeliveryStatus } from '../services/notificationService.js';
import { cancelReservationWithRefund } from '../services/reservationCancellationService.js';
import { CheckoutError } from '../utils/CheckoutError.js';
import { requestExtension } from '../services/extensionService.js';
import { getDepositDiscountPercent, hasReachedReservationLimit } from '../services/membershipService.js';
import { getReservationDeposit } from '../services/reservationDeposit.js';
import { validateBorrowingRules } from '../services/reservationRules.js';

const RESERVATION_ID_PATTERN = /^RES-[0-9a-f]{8}$/;
const DELIVERY_STATUSES = ['preparing', 'out-for-delivery', 'delivered'];
const updateDeliverySchema = joi.object({
    status: joi.string().valid(...DELIVERY_STATUSES).required()
});

const listMyReservationsSchema = joi.object({
    status: joi.string().valid('pending', 'upcoming', 'active', 'completed', 'cancelled', 'rejected'),
    view: joi.string().valid('upcoming', 'past'),
    from: joi.date().iso(),
    to: joi.date().iso().when('from', { is: joi.exist(), then: joi.date().min(joi.ref('from')) })
});

// the borrower, the item's lender (who also updates it) and admins can see a delivery
function canViewDelivery(user, reservation) {
    if (user.role === 'admin') return true;
    return reservation.borrower === user.id || reservation.lender === user.id;
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

// POST keeps the checkout contract. PATCH keeps the existing borrower-only API.
export async function getReservation(req, res, next) {
    try {
        const { reservationId } = req.params;
        if (!RESERVATION_ID_PATTERN.test(reservationId)) {
            return res.status(404).json({ message: 'Reservation not found' });
        }
        const reservation = await Reservation.findOne({
            _id: reservationId,
            $or: [{ borrower: req.user.id }, { lender: req.user.id }]
        }).populate('item', 'name category photos depositAmount pickup').lean();
        if (!reservation) return res.status(404).json({ message: 'Reservation not found' });
        return res.json({ reservation });
    } catch (error) {
        next(error);
    }
}

export async function cancelReservation(req, res, next) {
    const borrowerOnly = req.method === 'PATCH';
    const { reservationId } = req.params;
    if (borrowerOnly && !RESERVATION_ID_PATTERN.test(reservationId)) {
        return res.status(400).json({ message: 'Invalid reservation id' });
    }

    try {
        const result = await cancelReservationWithRefund(reservationId, req.user.id, { borrowerOnly });
        if (borrowerOnly) {
            return res.status(200).json({ reservation: result.reservation, refunded: result.refundAmount });
        }
        return res.status(200).json(result);
    } catch (error) {
        if (error instanceof CheckoutError) {
            return res.status(error.statusCode).json({ error: error.code, message: error.message });
        }
        return next(error);
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

        const previousReservation = await Reservation.findByIdAndUpdate(
            reservationId,
            { $set: { 'delivery.status': value.status } },
            { returnDocument: 'before', runValidators: true }
        ).lean();

        if (!previousReservation) {
            return res.status(404).json({ message: 'Reservation not found' });
        }

        if (
            previousReservation.delivery?.status !== value.status &&
            ['out-for-delivery', 'delivered'].includes(value.status)
        ) {
            await notifyDeliveryStatus(previousReservation, value.status);
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

function validateReservationItem(item, borrowerId, deliveryFlag) {
    if (item.owner.toString() === borrowerId) {
        return 'Cannot reserve your own item';
    }

    if (deliveryFlag && !item.delivery.offered) {
        return 'Item does not allow delivery';
    }
}

export async function createReservation(req, res, next) {
    try {
        const body = req.body ?? {};
        const { itemId, deliveryFlag, deliveryAddress } = body;

        const { start, end, error } = parseReservationInput(body);
        if (error) {
            return res.status(400).json({ message: error });
        }

        //load item and check if it exists and is not archived or flagged
        const item = await Item.findOne({ _id: itemId, archived: false, flagged: { $ne: true } });
        if (!item) {
            return res.status(404).json({ message: 'Item not found or unavailable' });
        }

        const itemError = validateReservationItem(item, req.user.id, deliveryFlag);
        if (itemError) {
            return res.status(400).json({ message: itemError });
        }

        const borrower = await User.findById(req.user.id);
        if (!borrower) {
            return res.status(404).json({ message: 'Borrower not found' });
        }

        validateBorrowingRules(item, borrower, start, end);

        // item owner is the lender, check if they are suspended
        const lender = await User.findById(item.owner);
        if (!lender) {
            return res.status(404).json({ message: 'Lender not found' });
        }

        if (lender.suspended) {
            return res.status(403).json({ message: 'Lender is suspended, cannot create reservation' });
        }

        // SCRUM-495 / 496: the borrower's own tier or an accepted household member's tier lowers the deposit
        const discountPercent = await getDepositDiscountPercent(borrower);
        const depositAmount = await getReservationDeposit(item, discountPercent);

        let conflict = false;
        let limit = null;
        let reservation;

        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                conflict = false;
                limit = null;

                // SCRUM-497: the tier decides how many reservations can be open at once
                const limitCheck = await hasReachedReservationLimit(borrower, session);
                if (limitCheck.reached) {
                    limit = limitCheck;
                    return;
                }

                // Use the same item lock as checkout before checking for overlap.
                const locked = await Item.updateOne(
                    { _id: itemId, archived: false, flagged: { $ne: true } },
                    { $inc: { checkoutVersion: 1 } },
                    { session }
                );
                if (locked.matchedCount !== 1) {
                    throw new CheckoutError(409, 'ITEM_UNAVAILABLE', 'Item is no longer available.');
                }

                // Check for overlapping reservations
                const overlappingReservation = await Reservation.findOverlap(itemId, start, end, session);
                if (overlappingReservation) {
                    conflict = true;
                    return;
                }

                const debit = await User.updateOne(
                    { _id: borrower._id, suspended: { $ne: true }, wallet: { $gte: depositAmount } },
                    { $inc: { wallet: -depositAmount } },
                    { session }
                );
                if (debit.matchedCount !== 1) {
                    throw new CheckoutError(409, 'WALLET_PAYMENT_FAILED',
                        'Insufficient wallet balance or borrower not eligible.');
                }

                reservation = new Reservation({
                    item: itemId,
                    borrower: req.user.id,
                    lender: item.owner,
                    payment: {
                        depositAmount,
                        discountPercent,
                        method: 'wallet',
                        depositCollected: true
                    },
                    cancellationPolicy: {
                        freeDays: item.cancellation?.freeDays ?? 0,
                        forfeitPercent: item.cancellation?.forfeitPercent ?? 0
                    },
                    startDate: start,
                    endDate: end,
                    delivery: deliveryFlag ? { address: deliveryAddress, fee: item.delivery.fee || 0 } : undefined,
                });

                await reservation.save({ session });
                await Payment.create([{
                    user: req.user.id,
                    reservation: reservation._id,
                    type: 'deposit-paid',
                    amount: depositAmount,
                    direction: 'deduct',
                    method: 'wallet',
                    status: 'completed'
                }], { session });
            });
        } finally {
            await session.endSession();
        }

        if (limit) {
            return res.status(403).json({
                message: `Your ${limit.tier} membership allows up to ${limit.limit} open reservations at a time`
            });
        }

        if (conflict) {
            return res.status(409).json({ message: 'Item is already reserved for the selected dates' });
        }

        return res.status(201).json({
            message: 'Reservation created successfully',
            reservationId: reservation._id,
            depositAmount,
            discountPercent
        });
    } catch (error) {
        if (error instanceof CheckoutError) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        next(error);
    }
}

export async function requestReservationExtension(req, res, next) {
    try {
        const result = await requestExtension(
            req.params.reservationId,
            req.user.id,
            req.body?.requestedEndDate
        );

        return res.status(201).json(result);
    } catch (error) {
        if (error instanceof CheckoutError) {
            return res.status(error.statusCode).json({
                error: error.code,
                message: error.message
            });
        }

        return next(error);
    }
}
