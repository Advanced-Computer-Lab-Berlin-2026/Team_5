
import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mocks = vi.hoisted(() => ({
    findOne: vi.fn(),
    createCardPaymentIntent: vi.fn()
}));

vi.mock('../models/Payment.js', () => ({
    Payment: { findOne: mocks.findOne }
}));

vi.mock('../services/stripeCheckoutService.js', () => ({
    createCardPaymentIntent: mocks.createCardPaymentIntent
}));

vi.mock('../middleware/auth.js', () => ({
    requireAuth: (req, res, next) => {
        if (req.get('X-Test-Auth') === 'missing') {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        req.user = {
            id: req.get('X-Test-User') || 'elBary',
            role: req.get('X-Test-Role') || 'member'
        };

        next();
    },

    requireRole: (...roles) => (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ message: 'Forbidden' });
        }

        next();
    }
}));

import stripeRouter from '../routes/stripe.js';

const app = express();
app.use(express.json());
app.use('/api/stripe', stripeRouter);

const paymentId = 'PAY-22a2e655';
const endpoint = `/api/stripe/payments/${paymentId}/status`;

function mockPayment(payment) {
    mocks.findOne.mockReturnValue({
        select: () => ({
            lean: async () => payment
        })
    });
}

beforeEach(() => {
    vi.resetAllMocks();

    mockPayment({
        _id: paymentId,
        status: 'completed',
        stripeAmountCents: 15000,
        reservations: ['RES-test-123'],
        updatedAt: new Date('2026-11-16T16:14:34.000Z')
    });
});

describe('GET Stripe payment status — SCRUM-431', () => {

    it('returns completed payment for its owner', async () => {
        const response = await request(app).get(endpoint);

        expect(response.status).toBe(200);
        expect(response.body.paymentId).toBe(paymentId);
        expect(response.body.status).toBe('completed');
        expect(response.body.amount).toBe(15000);
        expect(response.body.currency).toBe('eur');
        expect(response.body.reservations).toEqual(['RES-test-123']);

        expect(mocks.findOne).toHaveBeenCalledWith({
            _id: paymentId,
            user: 'elBary',
            method: 'card'
        });
    });

    it('returns awaiting_payment for pending cards', async () => {
        mockPayment({
            _id: paymentId,
            status: 'awaiting_payment',
            stripeAmountCents: 15000,
            reservations: []
        });

        const response = await request(app).get(endpoint);

        expect(response.status).toBe(200);
        expect(response.body.status).toBe('awaiting_payment');
        expect(response.body.reservations).toEqual([]);
    });

    it('returns refunded for refunded cards', async () => {
        mockPayment({
            _id: paymentId,
            status: 'refunded',
            stripeAmountCents: 15000,
            reservations: []
        });

        const response = await request(app).get(endpoint);

        expect(response.status).toBe(200);
        expect(response.body.status).toBe('refunded');
    });

    it('returns 401 for unauthenticated users', async () => {
        const response = await request(app)
            .get(endpoint)
            .set('X-Test-Auth', 'missing');

        expect(response.status).toBe(401);
        expect(mocks.findOne).not.toHaveBeenCalled();
    });

    it('lets a lender read their own card payment', async () => {
        const response = await request(app).get(endpoint).set('X-Test-Role', 'lender');
        expect(response.status).toBe(200);
        expect(mocks.findOne).toHaveBeenCalledWith({ _id: paymentId, user: 'elBary', method: 'card' });
    });

    it('returns 403 for admins', async () => {
        const response = await request(app)
            .get(endpoint)
            .set('X-Test-Role', 'admin');

        expect(response.status).toBe(403);
        expect(mocks.findOne).not.toHaveBeenCalled();
    });

    it('returns 404 when another member requests the payment', async () => {
        mockPayment(null);

        const response = await request(app)
            .get(endpoint)
            .set('X-Test-User', 'Youries');

        expect(response.status).toBe(404);
        expect(mocks.findOne).toHaveBeenCalledWith({
            _id: paymentId,
            user: 'Youries',
            method: 'card'
        });
    });

    it('returns 400 for an invalid payment ID', async () => {
        const response = await request(app)
            .get('/api/stripe/payments/invalid/status');

        expect(response.status).toBe(400);
        expect(mocks.findOne).not.toHaveBeenCalled();
    });
});
