import stripe from '../config/stripe.js';
import { Payment } from '../models/Payment.js';
import { prepareCheckout } from './checkoutService.js';
import { CheckoutError } from '../utils/CheckoutError.js';
import mongoose from 'mongoose';
import { Item } from '../models/Item.js';
import { User } from '../models/User.js';
import { Reservation } from '../models/Reservation.js';
import { lockAndCheckAvailability, removeConflictingBorrowListEntries} from './checkoutService.js';
import { calculateCheckoutPricing, normalizePromoCode } from './checkoutPricingService.js';
import { redeemCheckoutPromo, requirePromoRedemptionSupport } from './checkoutPromoRedemption.js';

export async function createCardPaymentIntent(userId, idempotencyKey, promoCode = null) {

    // 1. Validate the idempotency key
    if (
        typeof idempotencyKey !== 'string' ||
        !idempotencyKey.trim() ||
        idempotencyKey.trim().length > 128
    ) {
        throw new CheckoutError(
            400,
            'INVALID_IDEMPOTENCY_KEY',
            'A valid idempotency key is required.'
        );
    }

    const key = idempotencyKey.trim();
    const requestedPromo = normalizePromoCode(promoCode);

    // 2. Check whether a Payment already exists for this checkout
    let payment = await Payment.findOne({
        user: userId,
        checkoutKey: key
    });

    if (!payment) {

        // 3. Retrieve and validate the member's borrow list
        const checkoutItems = await prepareCheckout(userId);
        const pricing = await calculateCheckoutPricing(userId, checkoutItems, requestedPromo);
        if (pricing.promoCode) requirePromoRedemptionSupport();

        // 4. Validate the ACTUAL discounted amount Stripe will charge.
        const amountInCents = pricing.totalCents;
        if (
            !Number.isSafeInteger(amountInCents) ||
            amountInCents < 50 ||
            amountInCents > 99999999
        ) {
            throw new CheckoutError(
                400,
                'INVALID_PAYMENT_AMOUNT',
                'Discounted checkout amount is not valid for a Stripe card payment.'
            );
        }

        // 5. Save the pending payment before calling Stripe
        try {
            payment = await Payment.create({
                user: userId,
                type: 'deposit-pending',
                amount: pricing.totalDeposit,
                direction: 'deduct',
                method: 'card',
                status: 'awaiting_payment',
                checkoutKey: key,
                stripeAmountCents: pricing.totalCents,
                checkoutItems: pricing.items,
                promoCode: pricing.promoCode,
                originalTotal: pricing.originalTotal,
                promoDiscountPercent: pricing.discountPercent
            });

        } catch (error) {

            // Another request may have created the same payment
            if (error.code !== 11000) {
                throw error;
            }

            payment = await Payment.findOne({
                user: userId,
                checkoutKey: key
            });

            if (!payment) {
                throw error;
            }
        }
    }

    // Never reuse an existing PaymentIntent for a different promo selection.
    if (normalizePromoCode(payment.promoCode) !== requestedPromo) {
        throw new CheckoutError(
            409,
            'IDEMPOTENCY_KEY_CONFLICT',
            'This checkout key was already used with a different promo code.'
        );
    }

    // 6. Ensure we are working with a pending card payment
    if (
        payment.method !== 'card' ||
        payment.status !== 'awaiting_payment'
    ) {
        throw new CheckoutError(
            409,
            'PAYMENT_NOT_PENDING',
            'This checkout payment cannot be started again.'
        );
    }

    let paymentIntent;

    if (payment.stripePaymentIntentId) {

        // 7A. Reuse the existing Stripe PaymentIntent
        paymentIntent = await stripe.paymentIntents.retrieve(
            payment.stripePaymentIntentId
        );

    } else {

        // Avoid recreating a potentially existing Stripe payment
        // after Stripe's idempotency retention window.
        const paymentAge = Date.now() - payment.createdAt.getTime();

        if (paymentAge >= 23 * 60 * 60 * 1000) {
            throw new CheckoutError(
                409,
                'PAYMENT_REQUIRES_RECONCILIATION',
                'This payment attempt is too old to retry safely.'
            );
        }

        // 7B. Create the Stripe PaymentIntent
        paymentIntent = await stripe.paymentIntents.create(
        {
            amount: payment.stripeAmountCents,
            currency: 'eur',
            allowed_payment_method_types: ['card'],
            metadata: {
                paymentId: payment._id,
                userId: payment.user,
                checkoutKey: key
            }
        },
        {
            idempotencyKey: `shareshed-card-${payment._id}`
        }
    );

        // 8. Save the Stripe PaymentIntent ID
        const updatedPayment = await Payment.findOneAndUpdate(
            {
                _id: payment._id,
                status: 'awaiting_payment',
                $or: [
                    { stripePaymentIntentId: { $exists: false } },
                    { stripePaymentIntentId: null },
                    { stripePaymentIntentId: paymentIntent.id }
                ]
            },
            {
                $set: {
                    stripePaymentIntentId: paymentIntent.id
                }
            },
            { new: true }
        );

        if (!updatedPayment) {
            throw new Error(
                'Unable to associate Stripe PaymentIntent with payment.'
            );
        }
    }

    // 9. Verify the amount and currency match our saved payment
    if (
        paymentIntent.amount !== payment.stripeAmountCents ||
        paymentIntent.currency !== 'eur'
    ) {
        throw new Error('Stripe payment amount or currency mismatch.');
    }

    // 10. Do not allow completed/cancelled payments to be confirmed again
    if (![
        'requires_payment_method',
        'requires_confirmation',
        'requires_action'
    ].includes(paymentIntent.status)) {
        throw new CheckoutError(
            409,
            'PAYMENT_NOT_CONFIRMABLE',
            'This payment cannot be confirmed again.'
        );
    }

    // 11. Return the information needed by Stripe Elements
    return {
        paymentId: payment._id,
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency
    };
}


const UNAVAILABLE_CODES = new Set([
    'ITEM_UNAVAILABLE',
    'ITEM_ALREADY_RESERVED',
    'MEMBER_UNAVAILABLE',
    // These codes must be used by the teammate for permanent redemption failures.
    'PROMO_EXPIRED',
    'PROMO_USAGE_LIMIT_REACHED',
    'PROMO_NO_LONGER_VALID'
]);

// Read the saved checkout snapshot, not the current borrow list.
function readCheckoutItems(payment) {
    if (!payment.checkoutItems?.length) {
        throw new Error('Payment has no saved checkout items.');
    }

    const items = payment.checkoutItems.map(entry => ({
        itemId: entry.itemId,
        lenderId: entry.lenderId,
        startDate: new Date(entry.startDate),
        endDate: new Date(entry.endDate),
        depositAmount: entry.depositAmount
    }));

    let centsTotal = 0;
    const seenItems = new Set();

    for (const entry of items) {
        const cents = Math.round(entry.depositAmount * 100);

        if (
            !entry.itemId ||
            !entry.lenderId ||
            seenItems.has(entry.itemId) ||
            Number.isNaN(entry.startDate.getTime()) ||
            Number.isNaN(entry.endDate.getTime()) ||
            entry.endDate <= entry.startDate ||
            !Number.isFinite(entry.depositAmount) ||
            entry.depositAmount < 0 ||
            !Number.isSafeInteger(cents) ||
            Math.abs(entry.depositAmount * 100 - cents) > 0.000001
        ) {
            throw new Error('Corrupted checkout snapshot.');
        }

        seenItems.add(entry.itemId);
        centsTotal += cents;
    }

    if (
        !Number.isSafeInteger(centsTotal) ||
        centsTotal !== payment.stripeAmountCents ||
        Math.round(payment.amount * 100) !== centsTotal
    ) {
        throw new Error(
            'Payment snapshot total does not match charged amount.'
        );
    }

    return items;
}

// Verify that the Stripe payment belongs to this ShareShed payment.
function verifyPaymentIntent(payment, intent) {
    if (
        intent.status !== 'succeeded' ||
        intent.livemode !== false ||
        intent.currency !== 'eur' ||
        intent.id !== payment.stripePaymentIntentId ||
        intent.metadata?.paymentId !== payment._id ||
        intent.metadata?.userId !== payment.user ||
        intent.amount !== payment.stripeAmountCents ||
        intent.amount_received !== payment.stripeAmountCents ||
        payment.method !== 'card'
    ) {
        throw new Error('Stripe payment verification failed.');
    }
}

// Refund an already-charged checkout whose items became unavailable.
async function refundUnavailablePayment(paymentId) {
    let payment = await Payment.findOneAndUpdate(
        {
            _id: paymentId,
            status: 'awaiting_payment',
            method: 'card'
        },
        {
            $set: { status: 'refund_pending' }
        },
        { new: true }
    );

    if (!payment) {
        payment = await Payment.findById(paymentId);
    }

    if (!payment) {
        throw new Error('Payment not found during refund.');
    }

    if (payment.status === 'completed') {
        return { status: 'completed', paymentId };
    }

    if (payment.status === 'refunded') {
        return { status: 'refunded', paymentId };
    }

    if (payment.status !== 'refund_pending') {
        throw new Error('Unexpected payment refund state.');
    }

    let refund;

    // Reuse a previously saved refund.
    if (payment.stripeRefundId) {
        refund = await stripe.refunds.retrieve(payment.stripeRefundId);
    } else {
        // Also recover a refund that Stripe created before MongoDB
        // saved its refund ID.
        const previous = await stripe.refunds.list({
            payment_intent: payment.stripePaymentIntentId,
            limit: 100
        });

        refund = previous.data.find(r =>
            r.metadata?.shareshedPaymentId === payment._id &&
            r.amount === payment.stripeAmountCents
        );
    }

    if (!refund) {
        refund = await stripe.refunds.create(
            {
                payment_intent: payment.stripePaymentIntentId,
                metadata: {
                    shareshedPaymentId: payment._id,
                    purpose: 'unavailable_checkout'
                }
            },
            {
                idempotencyKey:
                    `shareshed-unavailable-refund-${payment._id}`
            }
        );
    }

    if (
        refund.status !== 'succeeded' &&
        refund.status !== 'pending'
    ) {
        throw new Error(
            `Stripe refund needs attention: ${refund.status}`
        );
    }

    await Payment.updateOne(
        {
            _id: payment._id,
            status: 'refund_pending'
        },
        {
            $set: {
                stripeRefundId: refund.id,
                ...(refund.status === 'succeeded'
                    ? { status: 'refunded' }
                    : {})
            }
        }
    );

    if (refund.status === 'pending') {
        throw new Error(
            'Stripe refund is pending; webhook should retry.'
        );
    }

    return {
        status: 'refunded',
        paymentId: payment._id,
        refundId: refund.id
    };
}

export async function finalizeCardPayment(paymentIntent) {
    const paymentId = paymentIntent?.metadata?.paymentId;

    if (!paymentId) {
        throw new Error(
            'PaymentIntent has no ShareShed payment ID.'
        );
    }

    const payment = await Payment.findById(paymentId);

    if (!payment) {
        throw new Error('ShareShed Payment not found.');
    }

    // Verify before processing any database changes.
    verifyPaymentIntent(payment, paymentIntent);

    // Repeated webhooks must not recreate reservations.
    if (payment.status === 'completed') {
        return {
            status: 'completed',
            paymentId,
            reservations: payment.reservations
        };
    }

    if (payment.status === 'refunded') {
        return { status: 'refunded', paymentId };
    }

    if (payment.status === 'refund_pending') {
        return refundUnavailablePayment(paymentId);
    }

    const session = await mongoose.startSession();

    try {
        return await session.withTransaction(async () => {
            const current = await Payment.findById(paymentId)
                .session(session);

            if (!current) {
                throw new Error(
                    'Payment disappeared during checkout.'
                );
            }

            // Recheck status inside the transaction.
            if (current.status === 'completed') {
                return {
                    status: 'completed',
                    paymentId,
                    reservations: current.reservations
                };
            }

            if (
                current.status === 'refund_pending' ||
                current.status === 'refunded'
            ) {
                return {
                    status: current.status,
                    paymentId
                };
            }

            if (
                current.status !== 'awaiting_payment' ||
                current.type !== 'deposit-pending'
            ) {
                throw new Error('Payment is not pending.');
            }

            const items = readCheckoutItems(current);

            const borrower = await User.findById(current.user)
                .session(session);

            if (
                !borrower ||
                borrower.suspended ||
                borrower.role !== 'member'
            ) {
                throw new CheckoutError(
                    409,
                    'MEMBER_UNAVAILABLE',
                    'Member can no longer checkout.'
                );
            }

            // Lock items and prevent overlapping reservations.
            await lockAndCheckAvailability(items, session);

            // Check whether the item or lender changed since
            // the PaymentIntent was created.
            for (const entry of items) {
                const item = await Item.findById(entry.itemId)
                    .session(session);

                if (
                    !item ||
                    item.archived ||
                    item.flagged ||
                    item.owner !== entry.lenderId ||
                    item.owner === current.user
                ) {
                    throw new CheckoutError(
                        409,
                        'ITEM_UNAVAILABLE',
                        'Item is no longer available.'
                    );
                }

                const owner = await User.findById(item.owner)
                    .session(session);

                if (!owner || owner.suspended) {
                    throw new CheckoutError(
                        409,
                        'ITEM_UNAVAILABLE',
                        'Item lender is unavailable.'
                    );
                }
            }

            const reservations = [];

            for (const entry of items) {
                const [reservation] = await Reservation.create(
                    [{
                        item: entry.itemId,
                        borrower: current.user,
                        lender: entry.lenderId,
                        startDate: entry.startDate,
                        endDate: entry.endDate,
                        status: 'pending',
                        payment: {
                            depositAmount: entry.depositAmount,
                            method: 'card',
                            stripePaymentIntentId: paymentIntent.id
                        }
                    }],
                    { session }
                );

                reservations.push(reservation._id);

                // Remove only this checkout's original entry.
                // Preserve any items added after payment started.
                await User.updateOne(
                    { _id: current.user },
                    {
                        $pull: {
                            borrow_list: {
                                item: entry.itemId,
                                startDate: entry.startDate,
                                endDate: entry.endDate
                            }
                        }
                    },
                    { session }
                );
            }

            // Keep your existing cleanup behavior.
            await removeConflictingBorrowListEntries(
                items,
                current.user,
                session
            );

            // Complete the payment in the same transaction.
            const result = await Payment.updateOne(
                {
                    _id: paymentId,
                    status: 'awaiting_payment'
                },
                {
                    $set: {
                        type: 'deposit-paid',
                        status: 'completed',
                        reservations
                    }
                },
                { session }
            );

            if (result.modifiedCount !== 1) {
                throw new Error(
                    'Payment was modified concurrently.'
                );
            }

            // One redemption per card checkout; a retry must not redeem again.
            await redeemCheckoutPromo({
                promoCode: current.promoCode,
                userId: current.user,
                paymentId: current._id,
                paymentIds: [current._id],
                reservationIds: reservations,
                session
            });

            return {
                status: 'completed',
                paymentId,
                reservations
            };
        });

    } catch (error) {

        // Business failure: the customer was charged,
        // but their checkout cannot be fulfilled.
        if (
            error instanceof CheckoutError &&
            UNAVAILABLE_CODES.has(error.code)
        ) {
            return refundUnavailablePayment(paymentId);
        }

        // Database/network failures must be retried.
        throw error;

    } finally {
        await session.endSession();
    }
}
