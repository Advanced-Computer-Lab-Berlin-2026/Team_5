import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import mongoose from 'mongoose';
import app from "../app.js";
import { User } from "../models/User.js";
import { MembershipTier } from "../models/MembershipTier.js";
import { requireAuth } from "../middleware/auth.js";
import { Payment } from '../models/Payment.js';
import stripe from '../config/stripe.js';
import { env } from '../config/env.js';
import { finalizeMembershipCardPayment } from '../services/membershipPaymentService.js';
import * as stripeCheckoutService from '../services/stripeCheckoutService.js';

vi.mock('../models/User.js', () => ({
    User: { findOneAndUpdate: vi.fn(), findById: vi.fn(), updateOne: vi.fn() }
}));

vi.mock('../models/MembershipTier.js', () => ({
    MembershipTier: { findById: vi.fn() }
}));

// replace only requireAuth, keep requireRole real so the role checks are tested too
vi.mock('../middleware/auth.js', async (importOriginal) => ({
    ...(await importOriginal()),
    requireAuth: vi.fn()
}));

const ORIGIN = 'http://localhost:3000';
const SUBSCRIBE_URL = '/api/membership/subscribe';
const CANCEL_URL = '/api/membership/cancel';

const tiers = {
    Plus: { tier: 'Plus', annual_fee: 300, deposit_discount: 10 },
    Premium: { tier: 'Premium', annual_fee: 800, deposit_discount: 25 }
};

function authenticateAs(id = 'member123', role = 'member') {
    requireAuth.mockImplementation((req, res, next) => {
        req.user = { id, role };
        next();
    });
}

function rejectAuth() {
    requireAuth.mockImplementation((req, res) =>
        res.status(401).json({ message: 'Authentication required' })
    );
}

function mockTierLookup(result) {
    const lean = vi.fn().mockResolvedValue(result);
    MembershipTier.findById.mockReturnValue({ lean });
}

// findOneAndUpdate(...).select('membership') resolves to the updated user (or null if no row matched)
function mockUpdate(result) {
    const select = vi.fn().mockResolvedValue(result);
    User.findOneAndUpdate.mockReturnValue({ select });
    return select;
}

function failUpdate() {
    const select = vi.fn().mockRejectedValue(new Error('Database unavailable'));
    User.findOneAndUpdate.mockReturnValue({ select });
}

const post = (url) => request(app).post(url).set('Origin', ORIGIN);
const subscribe = (body, key = 'membership-test-key') => post(SUBSCRIBE_URL).set('Idempotency-Key', key).send(body);
const wallet = { tier: 'Plus', method: 'wallet' };
const session = {};

beforeEach(() => {
    vi.resetAllMocks();
    vi.restoreAllMocks();

    authenticateAs();
    mockTierLookup(tiers.Plus);
    mockUpdate({ membership: { tier: 'Plus' } });
    vi.spyOn(mongoose.connection, 'transaction').mockImplementation((callback) => callback(session));
    vi.spyOn(Payment, 'findOne').mockReturnValue({ session: vi.fn().mockResolvedValue(null) });
    vi.spyOn(Payment, 'create').mockImplementation(async ([payment]) => [{ ...payment, _id: 'PAY-1' }]);
});

describe('POST /api/membership/subscribe', () => {
    it('returns 200, sets the tier and a renewal date one year after the start date', async () => {
        const response = await subscribe(wallet);

        expect(response.status).toBe(200);
        expect(response.body.message).toBe('Subscribed to Plus');
        expect(response.body.tier).toEqual(tiers.Plus);

        const [filter, update, options] = User.findOneAndUpdate.mock.calls[0];
        const { 'membership.tier': tier, 'membership.startDate': startDate, 'membership.renewalDate': renewalDate } = update.$set;

        expect(MembershipTier.findById).toHaveBeenCalledExactlyOnceWith('Plus');
        expect(tier).toBe('Plus');
        expect(startDate).toBeInstanceOf(Date);
        expect(renewalDate.getTime()).toBe(new Date(startDate).setUTCFullYear(startDate.getUTCFullYear() + 1));
        expect(options).toEqual({ session });
        expect(filter).toEqual({ _id: 'member123', wallet: { $gte: 300 }, $or: [
            { 'membership.tier': { $ne: 'Plus' } },
            { 'membership.renewalDate': { $type: 'date', $lte: startDate } }
        ] });
        expect(update.$inc).toEqual({ wallet: -300 });
        expect(Payment.create).toHaveBeenCalledWith([expect.objectContaining({
            user: 'member123', checkoutKey: 'membership-test-key', type: 'membership-fee', method: 'wallet', direction: 'deduct', amount: 300
        })], { session });
    });

    it('works for Premium and for lenders', async () => {
        authenticateAs('lender1', 'lender');
        mockTierLookup(tiers.Premium);
        mockUpdate({ membership: { tier: 'Premium' } });

        const response = await subscribe({ ...wallet, tier: 'Premium' });

        expect(response.status).toBe(200);
        expect(response.body.tier).toEqual(tiers.Premium);
        expect(User.findOneAndUpdate.mock.calls[0][0]._id).toBe('lender1');
    });

    it('returns the updated membership in the response', async () => {
        const response = await subscribe(wallet);
        const update = User.findOneAndUpdate.mock.calls[0][1].$set;
        expect(response.body.membership).toEqual({
            tier: 'Plus',
            startDate: update['membership.startDate'].toISOString(),
            renewalDate: update['membership.renewalDate'].toISOString()
        });
    });

    it.each([
        ['Basic', { tier: 'Basic' }],
        ['a missing tier', {}],
        ['a non-string tier', { tier: 5 }]
    ])('returns 400 for %s', async (_name, body) => {
        const response = await subscribe({ method: 'wallet', ...body });

        expect(response.status).toBe(400);
        expect(MembershipTier.findById).not.toHaveBeenCalled();
        expect(User.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('returns 400 when there is no body at all', async () => {
        const response = await post(SUBSCRIBE_URL);

        expect(response.status).toBe(400);
        expect(User.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it.each(['Gold', 'plus'])('returns 404 when %s is missing from the database', async (tier) => {
        mockTierLookup(null);

        const response = await subscribe({ ...wallet, tier });

        expect(response.status).toBe(404);
        expect(User.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('returns 409 when the member is already on that tier', async () => {
        mockUpdate(null);
        User.findById.mockReturnValue({ select: () => ({ session: async () => ({ membership: { tier: 'Plus' } }) }) });

        const response = await subscribe(wallet);

        expect(response.status).toBe(409);
        expect(response.body.message).toBe('You are already subscribed to Plus');
    });

    it('returns 401 when the request is not authenticated', async () => {
        rejectAuth();

        const response = await subscribe(wallet);

        expect(response.status).toBe(401);
        expect(User.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('returns 403 for admins', async () => {
        authenticateAs('admin1', 'admin');

        const response = await subscribe(wallet);

        expect(response.status).toBe(403);
        expect(User.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('returns 403 without a trusted origin (CSRF)', async () => {
        const response = await request(app).post(SUBSCRIBE_URL).send({ tier: 'Plus' });

        expect(response.status).toBe(403);
        expect(User.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('returns 500 with a general message when the database fails', async () => {
        failUpdate();

        const response = await subscribe(wallet);

        expect(response.status).toBe(500);
        expect(response.body).toEqual({ message: 'Server Error' });
    });

    it('requires a payment method and idempotency key', async () => {
        expect((await subscribe({ tier: 'Plus' })).status).toBe(400);
        expect((await subscribe({ tier: 'Plus', method: 'cash' })).status).toBe(400);
        expect((await post(SUBSCRIBE_URL).send(wallet)).status).toBe(400);
        expect(Payment.create).not.toHaveBeenCalled();
    });

    it('rejects insufficient wallet balance without recording a payment', async () => {
        mockUpdate(null);
        User.findById.mockReturnValue({ select: () => ({ session: async () => ({ membership: { tier: 'Basic' } }) }) });

        const response = await subscribe(wallet);

        expect(response.status).toBe(409);
        expect(response.body.code).toBe('INSUFFICIENT_WALLET_BALANCE');
        expect(Payment.create).not.toHaveBeenCalled();
    });

    it('does not deduct again when a completed wallet request is retried', async () => {
        Payment.findOne.mockReturnValue({ session: async () => ({
            _id: 'PAY-1', type: 'membership-fee', membershipTier: 'Plus', method: 'wallet', date: new Date()
        }) });

        const response = await subscribe(wallet);

        expect(response.status).toBe(200);
        expect(response.body.paymentId).toBe('PAY-1');
        expect(User.findOneAndUpdate).not.toHaveBeenCalled();
        expect(Payment.create).not.toHaveBeenCalled();
    });

    it('returns a Stripe client secret without activating a membership', async () => {
        const originalSecret = env.stripeWebhookSecret;
        env.stripeWebhookSecret = 'whsec_test';
        try {
            User.findById.mockReturnValue({ select: () => ({ lean: async () => ({ membership: { tier: 'Basic' } }) }) });
            Payment.create.mockImplementation(async (payment) => ({ ...payment, _id: 'PAY-2', createdAt: new Date() }));
            vi.spyOn(Payment, 'updateOne').mockResolvedValue({ matchedCount: 1 });
            const createIntent = vi.spyOn(stripe.paymentIntents, 'create').mockResolvedValue({
                id: 'pi_test', amount: 30000, currency: 'eur', status: 'requires_payment_method', client_secret: 'secret_test'
            });

            const response = await subscribe({ tier: 'Plus', method: 'card' });

            expect(response.status).toBe(202);
            expect(response.body).toMatchObject({ status: 'awaiting_payment', paymentId: 'PAY-2', clientSecret: 'secret_test' });
            expect(createIntent).toHaveBeenCalledWith(expect.objectContaining({
                amount: 30000, allowed_payment_method_types: ['card'], metadata: {
                    purpose: 'membership-fee', paymentId: 'PAY-2', userId: 'member123'
                }
            }), { idempotencyKey: 'shareshed-membership-PAY-2' });
            expect(User.findOneAndUpdate).not.toHaveBeenCalled();
            expect(User.updateOne).not.toHaveBeenCalled();
        } finally {
            env.stripeWebhookSecret = originalSecret;
        }
    });

    it('rejects a key already used for reservation checkout', async () => {
        Payment.findOne.mockReturnValue({ session: async () => ({ type: 'deposit-pending', method: 'card' }) });

        const response = await subscribe(wallet);

        expect(response.status).toBe(409);
        expect(response.body.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
        expect(Payment.findOne).toHaveBeenCalledExactlyOnceWith({ user: 'member123', checkoutKey: 'membership-test-key' });
        expect(User.findOneAndUpdate).not.toHaveBeenCalled();
    });
});

describe('membership card payment finalization', () => {
    const intent = {
        id: 'pi_test', amount: 30000, amount_received: 30000, currency: 'eur', status: 'succeeded',
        metadata: { paymentId: 'PAY-2', userId: 'member123' }
    };

    function mockCardPayment() {
        const payment = {
            user: 'member123', status: 'awaiting_payment', stripePaymentIntentId: intent.id, stripeAmountCents: 30000,
            previousMembershipTier: 'Basic', previousMembershipStartDate: new Date('2026-01-01'),
            membershipTier: 'Plus', save: vi.fn()
        };
        Payment.findOne.mockReturnValue({ session: async () => payment });
        return payment;
    }

    it('activates the tier once after verifying a confirmed payment', async () => {
        const payment = mockCardPayment();
        User.updateOne.mockResolvedValue({ matchedCount: 1 });

        await finalizeMembershipCardPayment(intent);
        await finalizeMembershipCardPayment(intent);

        expect(payment.status).toBe('completed');
        expect(payment.save).toHaveBeenCalledExactlyOnceWith({ session });
        expect(User.updateOne).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            _id: 'member123', 'membership.tier': 'Basic', 'membership.startDate': payment.previousMembershipStartDate
        }), { $set: expect.objectContaining({ 'membership.tier': 'Plus' }) }, { session });
    });

    it('rejects a mismatched Stripe amount before updating membership', async () => {
        const payment = mockCardPayment();

        await expect(finalizeMembershipCardPayment({ ...intent, amount_received: 100 })).rejects.toThrow('verification failed');

        expect(payment.save).not.toHaveBeenCalled();
        expect(User.updateOne).not.toHaveBeenCalled();
    });

    it('refunds a confirmed card payment when the membership has changed', async () => {
        const payment = mockCardPayment();
        User.updateOne.mockResolvedValue({ matchedCount: 0 });
        const refund = vi.spyOn(stripeCheckoutService, 'refundUnavailablePayment').mockResolvedValue({ status: 'refunded' });

        await finalizeMembershipCardPayment(intent);

        expect(payment.status).toBe('refund_pending');
        expect(payment.save).toHaveBeenCalledExactlyOnceWith({ session });
        expect(refund).toHaveBeenCalledExactlyOnceWith('PAY-2');
    });
});

describe('POST /api/membership/cancel', () => {
    beforeEach(() => {
        mockUpdate({ membership: { tier: 'Basic', renewalDate: null } });
    });

    it('returns 200 and puts the member back on Basic immediately with no renewal date', async () => {
        const response = await post(CANCEL_URL);

        expect(response.status).toBe(200);
        expect(response.body.message).toBe('Membership cancelled. You are back on Basic');
        expect(response.body.membership).toEqual({ tier: 'Basic', renewalDate: null });

        const [filter, update, options] = User.findOneAndUpdate.mock.calls[0];

        expect(update.$set['membership.tier']).toBe('Basic');
        expect(update.$set['membership.renewalDate']).toBeNull();
        expect(update.$set['membership.startDate']).toBeInstanceOf(Date);
        expect(options).toEqual({ returnDocument: 'after' });
        // only updates a user who is on a paid tier
        expect(filter).toEqual({ _id: 'member123', 'membership.tier': { $exists: true, $nin: ['Basic', null] } });
    });

    it('works for lenders', async () => {
        authenticateAs('lender1', 'lender');

        const response = await post(CANCEL_URL);

        expect(response.status).toBe(200);
        expect(User.findOneAndUpdate.mock.calls[0][0]._id).toBe('lender1');
    });

    it('returns 409 when the member is already on Basic', async () => {
        mockUpdate(null);

        const response = await post(CANCEL_URL);

        expect(response.status).toBe(409);
        expect(response.body.message).toBe('You have no paid membership to cancel');
    });

    it('returns 401 when the request is not authenticated', async () => {
        rejectAuth();

        const response = await post(CANCEL_URL);

        expect(response.status).toBe(401);
        expect(User.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('returns 403 for admins', async () => {
        authenticateAs('admin1', 'admin');

        const response = await post(CANCEL_URL);

        expect(response.status).toBe(403);
        expect(User.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('returns 403 without a trusted origin (CSRF)', async () => {
        const response = await request(app).post(CANCEL_URL);

        expect(response.status).toBe(403);
        expect(User.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('returns 500 with a general message when the database fails', async () => {
        failUpdate();

        const response = await post(CANCEL_URL);

        expect(response.status).toBe(500);
        expect(response.body).toEqual({ message: 'Server Error' });
    });
});
