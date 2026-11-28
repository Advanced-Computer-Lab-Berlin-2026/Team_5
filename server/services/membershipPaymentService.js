import mongoose from 'mongoose';
import stripe from '../config/stripe.js';
import { env } from '../config/env.js';
import { Payment } from '../models/Payment.js';
import { User } from '../models/User.js';
import { CheckoutError } from '../utils/CheckoutError.js';
import { refundUnavailablePayment } from './stripeCheckoutService.js';
import { activeTier } from './membershipService.js';

const PAYMENT_TYPE = 'membership-fee';
const PAYMENT_INTENT_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;

export function oneYearAfter(date) {
    const renewal = new Date(date);
    renewal.setUTCFullYear(renewal.getUTCFullYear() + 1);
    return renewal;
}

function membershipUpdate(tier, startDate) {
    return {
        'membership.tier': tier,
        'membership.startDate': startDate,
        'membership.renewalDate': oneYearAfter(startDate)
    };
}

function alreadySubscribed(tier) {
    return new CheckoutError(409, 'ALREADY_SUBSCRIBED', `You are already subscribed to ${tier}`);
}

function completedWalletPayment(payment) {
    return {
        status: 'completed',
        paymentId: payment._id,
        membership: {
            tier: payment.membershipTier,
            startDate: payment.date,
            renewalDate: oneYearAfter(payment.date)
        }
    };
}

export async function payForMembership(userId, tier, method, key) {
    if (!Number.isFinite(tier.annual_fee) || tier.annual_fee < 0) {
        throw new CheckoutError(409, 'INVALID_MEMBERSHIP_FEE', 'This membership has an invalid fee.');
    }
    const lookup = { user: userId, checkoutKey: key };
    const findPayment = async (session = null) => {
        const payment = await Payment.findOne(lookup).session(session);
        if (payment && (payment.type !== PAYMENT_TYPE || payment.method !== method || payment.membershipTier !== tier.tier)) {
            throw new CheckoutError(409, 'IDEMPOTENCY_KEY_CONFLICT', 'This Idempotency-Key was already used for a different checkout.');
        }
        return payment;
    };
    const paymentDetails = {
        ...lookup,
        type: PAYMENT_TYPE,
        amount: tier.annual_fee,
        membershipTier: tier.tier,
        method,
        direction: 'deduct'
    };

    return method === 'wallet'
        ? payWithWallet(userId, tier, paymentDetails, findPayment)
        : startCardPayment(userId, tier, paymentDetails, findPayment);
}

async function payWithWallet(userId, tier, paymentDetails, findPayment) {
    try {
        return await mongoose.connection.transaction(async (session) => {
            const existing = await findPayment(session);
            if (existing) return completedWalletPayment(existing);

            const startDate = new Date();
            const user = await User.findOneAndUpdate(
                { _id: userId, wallet: { $gte: tier.annual_fee }, $or: [
                    { 'membership.tier': { $ne: tier.tier } },
                    { 'membership.renewalDate': { $type: 'date', $lte: startDate } }
                ] },
                { $inc: { wallet: -tier.annual_fee }, $set: membershipUpdate(tier.tier, startDate) },
                { session }
            ).select('_id');
            if (!user) {
                const current = await User.findById(userId).select('membership').session(session);
                if (!current) throw new CheckoutError(404, 'USER_NOT_FOUND', 'User not found.');
                if (activeTier(current.membership, startDate) === tier.tier) throw alreadySubscribed(tier.tier);
                throw new CheckoutError(409, 'INSUFFICIENT_WALLET_BALANCE', 'Insufficient wallet balance for this membership.');
            }

            const [payment] = await Payment.create([{ ...paymentDetails, date: startDate }], { session });
            return completedWalletPayment(payment);
        });
    } catch (error) {
        if (error.code !== 11000) throw error;
        const existing = await findPayment();
        if (!existing) throw error;
        return completedWalletPayment(existing);
    }
}

async function createMembershipCardPayment(userId, tier, paymentDetails, findPayment) {
    const user = await User.findById(userId).select('membership').lean();
    if (!user) throw new CheckoutError(404, 'USER_NOT_FOUND', 'User not found.');
    if (activeTier(user.membership) === tier.tier) throw alreadySubscribed(tier.tier);

    const stripeAmountCents = Math.round(tier.annual_fee * 100);
    if (!Number.isSafeInteger(stripeAmountCents) || stripeAmountCents < 50 || stripeAmountCents > 99999999) {
        throw new CheckoutError(400, 'INVALID_CARD_AMOUNT', 'The membership fee is unavailable for card payment.');
    }

    try {
        return await Payment.create({
            ...paymentDetails, stripeAmountCents, status: 'awaiting_payment',
            previousMembershipTier: user.membership?.tier ?? null,
            previousMembershipStartDate: user.membership?.startDate ?? null
        });
    } catch (error) {
        if (error.code !== 11000) throw error;
        const payment = await findPayment();
        if (!payment) throw error;
        return payment;
    }
}

async function startCardPayment(userId, tier, paymentDetails, findPayment) {
    if (!env.stripeWebhookSecret) throw new CheckoutError(503, 'CARD_PAYMENT_UNAVAILABLE', 'Card payment is unavailable.');

    const payment = await findPayment() ?? await createMembershipCardPayment(userId, tier, paymentDetails, findPayment);

    const response = { paymentId: payment._id, status: payment.status };
    if (payment.status !== 'awaiting_payment') return response;

    if (!payment.stripePaymentIntentId && Date.now() - payment.createdAt.getTime() >= PAYMENT_INTENT_RETRY_WINDOW_MS) {
        throw new CheckoutError(409, 'PAYMENT_REQUIRES_RECONCILIATION', 'This payment attempt is too old to retry safely.');
    }
    const intent = payment.stripePaymentIntentId
        ? await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId)
        : await stripe.paymentIntents.create({
            amount: payment.stripeAmountCents,
            currency: 'eur',
            allowed_payment_method_types: ['card'],
            metadata: { purpose: PAYMENT_TYPE, paymentId: payment._id, userId }
        }, { idempotencyKey: `shareshed-membership-${payment._id}` });

    if (intent.amount !== payment.stripeAmountCents || intent.currency !== 'eur') {
        throw new Error('Stripe membership payment amount or currency mismatch.');
    }
    if (!payment.stripePaymentIntentId) {
        const saved = await Payment.updateOne(
            { _id: payment._id, status: 'awaiting_payment', stripePaymentIntentId: { $in: [null, intent.id] } },
            { $set: { stripePaymentIntentId: intent.id } }
        );
        if (!saved.matchedCount) throw new Error('Unable to associate Stripe PaymentIntent with membership payment.');
    }

    if (intent.status === 'canceled') {
        await Payment.updateOne({ _id: payment._id, status: 'awaiting_payment' }, { $set: { status: 'failed' } });
        return { ...response, status: 'failed' };
    }

    return {
        ...response,
        paymentIntentId: intent.id,
        amount: intent.amount,
        currency: intent.currency,
        ...(['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(intent.status)
            ? { clientSecret: intent.client_secret } : {})
    };
}

export async function finalizeMembershipCardPayment(intent) {
    const paymentId = intent.metadata.paymentId;
    const status = await mongoose.connection.transaction(async (session) => {
        const payment = await Payment.findOne({ _id: paymentId, type: PAYMENT_TYPE, method: 'card' }).session(session);
        if (!payment || payment.stripePaymentIntentId !== intent.id || payment.user !== intent.metadata.userId ||
            intent.status !== 'succeeded' || intent.currency !== 'eur' ||
            intent.amount !== payment.stripeAmountCents || intent.amount_received !== payment.stripeAmountCents) {
            throw new Error('Stripe membership payment verification failed.');
        }
        if (payment.status !== 'awaiting_payment') return payment.status;

        const result = await User.updateOne({
            _id: payment.user,
            suspended: { $ne: true },
            role: { $in: ['member', 'lender'] },
            'membership.tier': payment.previousMembershipTier ?? null,
            'membership.startDate': payment.previousMembershipStartDate ?? null
        }, { $set: membershipUpdate(payment.membershipTier, new Date()) }, { session });

        payment.status = result.matchedCount ? 'completed' : 'refund_pending';
        await payment.save({ session });
        return payment.status;
    });

    if (status === 'refund_pending') await refundUnavailablePayment(paymentId);
}
