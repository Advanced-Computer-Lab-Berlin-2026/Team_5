
import mongoose from 'mongoose';
import { Reservation } from '../models/Reservation.js';
import { Payment } from '../models/Payment.js';
import { Item } from '../models/Item.js';
import { User } from '../models/User.js';
import { notifyReservationCancelled, notifyWishlistItemAvailable } from './notificationService.js';
import { promoteWaitlistAfterCancellation } from './waitlistPromotion.js';
import { CheckoutError } from '../utils/CheckoutError.js';
import { calculateCancellationRefund } from './cancellationPolicy.js';

const CANCELLABLE_STATUSES = ['pending', 'upcoming'];

function getCancellationActor(reservation, userId, borrowerOnly) {
    if (userId === reservation.borrower) return 'member';
    if (!borrowerOnly && userId === reservation.lender) return 'lender';
    throw new CheckoutError(
        403,
        'NOT_RESERVATION_PARTICIPANT',
        borrowerOnly ? 'You can only cancel your own reservations' : 'Only the borrower or lender may cancel.'
    );
}

function getCancellationWindow(reservation, cancelledAt) {
    const expiredRequest = reservation.status === 'pending' && new Date(reservation.startDate) <= cancelledAt;
    if (!CANCELLABLE_STATUSES.includes(reservation.status) ||
        (!expiredRequest && new Date(reservation.startDate) <= cancelledAt) ||
        reservation.handover?.pickedUpAt) {
        throw new CheckoutError(409, 'CANCELLATION_NOT_ALLOWED', 'This reservation cannot be cancelled.');
    }
    const filter = expiredRequest
        ? { status: 'pending' }
        : { status: { $in: CANCELLABLE_STATUSES }, startDate: { $gt: cancelledAt } };
    return { expiredRequest, filter };
}

function asCents(value) {
    const scaled = value * 100;
    const cents = Math.round(scaled);

    if (!Number.isFinite(value) || !Number.isSafeInteger(cents) ||
        cents < 0 || Math.abs(scaled - cents) > 0.000001) {
        throw new CheckoutError(
            409,
            'INVALID_DEPOSIT',
            'Stored deposit is invalid.'
        );
    }

    return cents;
}

async function findOriginalPayment(reservation, session) {
    const common = {
        user: reservation.borrower,
        type: 'deposit-paid',
        status: 'completed',
        direction: 'deduct',
        method: reservation.payment.method
    };

    let payments;

    if (reservation.payment.method === 'wallet') {
        payments = await Payment.find({
            ...common,
            // Wallet deposit records from before checkout had no status field.
            status: { $in: ['completed', null] },
            reservation: reservation._id
        }).session(session);

    } else if (reservation.payment.method === 'card') {
        if (!reservation.payment.stripePaymentIntentId) {
            throw new CheckoutError(
                409,
                'PAYMENT_NOT_VERIFIED',
                'Missing Stripe payment reference.'
            );
        }

        payments = await Payment.find({
            ...common,
            reservations: reservation._id,
            stripePaymentIntentId: reservation.payment.stripePaymentIntentId
        }).session(session);

    } else {
        throw new CheckoutError(
            409,
            'PAYMENT_NOT_VERIFIED',
            'Unsupported payment method.'
        );
    }

    if (payments.length !== 1) {
        throw new CheckoutError(
            409,
            'PAYMENT_NOT_VERIFIED',
            'Exactly one completed original payment is required.'
        );
    }

    const payment = payments[0];
    const depositCents = asCents(reservation.payment.depositAmount);

    if (reservation.payment.method === 'wallet') {
        if (asCents(payment.amount) !== depositCents) {
            throw new CheckoutError(
                409,
                'PAYMENT_MISMATCH',
                'Wallet payment amount mismatch.'
            );
        }
        if (reservation.delivery?.feeCollected) {
            const deliveryPayments = await Payment.find({
                ...common, type: 'delivery-fee', reservation: reservation._id
            }).session(session);
            if (deliveryPayments.length !== 1 || asCents(deliveryPayments[0].amount) !== asCents(reservation.delivery.fee)) {
                throw new CheckoutError(409, 'PAYMENT_MISMATCH', 'Wallet delivery payment amount mismatch.');
            }
        }

    } else {
        const matches = payment.checkoutItems.filter(entry =>
            entry.itemId === reservation.item &&
            entry.lenderId === reservation.lender &&
            new Date(entry.startDate).getTime() ===
                new Date(reservation.startDate).getTime() &&
            new Date(entry.endDate).getTime() ===
                new Date(reservation.endDate).getTime()
        );

        if (
            matches.length !== 1 ||
            asCents(matches[0].depositAmount) !== depositCents ||
            asCents(matches[0].delivery?.fee ?? 0) !== asCents(reservation.delivery?.feeCollected ? reservation.delivery.fee : 0) ||
            asCents(payment.amount) !== payment.stripeAmountCents
        ) {
            throw new CheckoutError(
                409,
                'PAYMENT_MISMATCH',
                'Stripe item allocation mismatch.'
            );
        }
    }

    return payment;
}

async function getPolicy(reservation, session) {
    const saved = reservation.cancellationPolicy;

    if (
        saved &&
        Number.isFinite(saved.freeDays) &&
        Number.isFinite(saved.forfeitPercent)
    ) {
        return {
            freeDays: saved.freeDays,
            forfeitPercent: saved.forfeitPercent
        };
    }

    // Fallback for older reservations with no policy snapshot.
    const item = await Item.findById(reservation.item).session(session);

    if (!item) {
        throw new CheckoutError(
            409,
            'POLICY_UNAVAILABLE',
            'Cancellation policy is unavailable.'
        );
    }

    return {
        freeDays: item.cancellation?.freeDays ?? 0,
        forfeitPercent: item.cancellation?.forfeitPercent ?? 0
    };
}

async function getRefundAmount(reservation, cancelledBy, cancelledAt, session) {
    // The lender always gives a full refund.
    const policy = cancelledBy === 'member'
        ? await getPolicy(reservation, session)
        : { freeDays: 0, forfeitPercent: 0 };

    return calculateCancellationRefund({
        paidDeposit: reservation.payment.depositAmount,
        cancelledBy,
        startDate: reservation.startDate,
        cancelledAt,
        ...policy
    });
}

function cancellationResult(reservation, { refundAmount, refundPaymentId = null, replayed }, borrowerOnly) {
    return {
        reservationId: reservation._id,
        status: 'cancelled',
        refundAmount,
        refundPaymentId,
        replayed,
        ...(borrowerOnly ? { reservation } : {})
    };
}

async function existingResult(reservation, session, borrowerOnly) {
    if (!reservation.cancellationRefundPaymentId) {
        if (reservation.payment?.depositCollected === false && reservation.cancellationRefundAmount === 0) {
            return cancellationResult(reservation, { refundAmount: 0, replayed: true }, borrowerOnly);
        }
        throw new CheckoutError(
            409,
            'ALREADY_CANCELLED',
            'Reservation was cancelled before this refund flow.'
        );
    }

    const refund = await Payment.findOne({
        _id: reservation.cancellationRefundPaymentId,
        refundKey: `cancellation:${reservation._id}`,
        reservation: reservation._id,
        user: reservation.borrower,
        type: 'deposit-refund',
        method: 'wallet',
        direction: 'receive',
        status: 'completed'
    }).session(session);

    if (
        !refund ||
        asCents(refund.amount) !==
            asCents(reservation.cancellationRefundAmount)
    ) {
        throw new CheckoutError(
            409,
            'REFUND_RECORD_MISSING',
            'Cancellation refund record is inconsistent.'
        );
    }

    return cancellationResult(reservation, {
        refundAmount: refund.amount,
        refundPaymentId: refund._id,
        replayed: true
    }, borrowerOnly);
}

export function expireUnansweredReservation(reservationId) {
    return cancelReservationWithRefund(reservationId, null, { automaticExpiry: true });
}

export async function cancelReservationWithRefund(reservationId, userId, { borrowerOnly = false, automaticExpiry = false } = {}) {
    if (!/^RES-[a-zA-Z0-9_-]{1,100}$/.test(reservationId)) {
        throw new CheckoutError(
            400,
            'INVALID_RESERVATION_ID',
            'Invalid reservation ID.'
        );
    }

    const session = await mongoose.startSession();

    try {
        const result = await session.withTransaction(async () => {
            const reservation = await Reservation.findById(
                reservationId
            ).session(session);
            const cancelledAt = new Date();
            if (automaticExpiry && (reservation?.status !== 'pending' || new Date(reservation.startDate) > cancelledAt)) {
                return null;
            }

            if (!reservation) {
                throw new CheckoutError(
                    404,
                    'RESERVATION_NOT_FOUND',
                    'Reservation not found.'
                );
            }

            const cancelledBy = automaticExpiry ? null : getCancellationActor(reservation, userId, borrowerOnly);

            // Repeated requests must not refund twice.
            if (reservation.status === 'cancelled') {
                return existingResult(reservation, session, borrowerOnly);
            }

            const { expiredRequest, filter } = getCancellationWindow(reservation, cancelledAt);

            // A direct reservation can be cancelled without refunding its quoted deposit.
            const originalPayment = reservation.payment?.depositCollected === false
                ? null
                : await findOriginalPayment(reservation, session);

            const depositRefund = originalPayment
                ? (expiredRequest ? reservation.payment.depositAmount : await getRefundAmount(reservation, cancelledBy, cancelledAt, session))
                : 0;
            const refundAmount = originalPayment && reservation.delivery?.feeCollected
                ? (asCents(depositRefund) + asCents(reservation.delivery.fee)) / 100
                : depositRefund;

            // Atomically change the reservation state.
            const updated = await Reservation.findOneAndUpdate(
                {
                    _id: reservation._id,
                    ...filter,
                    'handover.pickedUpAt': null
                },
                {
                    $set: {
                        status: 'cancelled',
                        cancelledAt,
                        ...(!automaticExpiry && { cancelledBy, cancelledByUser: userId }),
                        cancellationRefundAmount: refundAmount
                    }
                },
                { session, new: true }
            );

            if (!updated) {
                throw new CheckoutError(
                    409,
                    'CANCELLATION_CONFLICT',
                    'Reservation changed during cancellation; retry.'
                );
            }

            if (!originalPayment) {
                return cancellationResult(updated, { refundAmount, replayed: false }, true);
            }

            // Credit the MEMBER, regardless of who cancelled.
            const member = await User.findOneAndUpdate(
                { _id: reservation.borrower },
                { $inc: { wallet: refundAmount } },
                { session, new: true }
            );

            if (!member) {
                throw new Error(
                    'Borrower not found during wallet refund.'
                );
            }

            // One refund Payment per reservation cancellation.
            const [refund] = await Payment.create([{
                user: reservation.borrower,
                reservation: reservation._id,
                sourcePaymentId: originalPayment._id,
                refundKey: `cancellation:${reservation._id}`,
                type: 'deposit-refund',
                amount: refundAmount,
                direction: 'receive',
                method: 'wallet',
                status: 'completed',
                description: automaticExpiry ? 'Unanswered reservation expired' : `Reservation cancelled by ${cancelledBy}`
            }], { session });

            // Store the refund ID for future idempotent requests.
            const saved = await Reservation.updateOne(
                {
                    _id: reservation._id,
                    status: 'cancelled'
                },
                {
                    $set: {
                        cancellationRefundPaymentId: refund._id
                    }
                },
                { session }
            );

            if (saved.matchedCount !== 1) {
                throw new Error(
                    'Failed to link cancellation refund.'
                );
            }

            updated.cancellationRefundPaymentId = refund._id;
            return cancellationResult(updated, {
                refundAmount,
                refundPaymentId: refund._id,
                replayed: false
            }, true);
        });

        if (!result) return null;
        const { reservation, ...response } = result;
        if (!response.replayed) {
            const notifications = await Promise.allSettled([
                automaticExpiry ? notifyReservationCancelled(reservation, { automaticExpiry: true }) : notifyReservationCancelled(reservation),
                notifyWishlistItemAvailable(reservation.item),
                promoteWaitlistAfterCancellation(reservation)
            ]);
            for (const notification of notifications) {
                if (notification.status === 'rejected') {
                    console.error(`Cancellation notification failed for ${reservationId}`, notification.reason);
                }
            }
        }
        return borrowerOnly ? result : response;

    } catch (error) {
        // Handle an idempotent retry after a unique-index race.
        if (error.code === 11000) {
            const current = await Reservation.findById(reservationId);

            if (
                current &&
                (current.borrower === userId || (!borrowerOnly && current.lender === userId)) &&
                current.status === 'cancelled'
            ) {
                return existingResult(current, null, borrowerOnly);
            }
        }

        throw error;

    } finally {
        await session.endSession();
    }
}
