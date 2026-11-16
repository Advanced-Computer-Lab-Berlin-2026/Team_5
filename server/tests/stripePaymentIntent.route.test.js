import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mocks = vi.hoisted(() => ({ createCardPaymentIntent: vi.fn() }));

vi.mock('../services/stripeCheckoutService.js', () => ({
  createCardPaymentIntent: mocks.createCardPaymentIntent,
}));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req, res, next) => {
    if (req.get('X-Test-Auth') === 'missing') {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    req.user = { id: 'member1', role: req.get('X-Test-Role') || 'member' };
    return next();
  },
  requireRole: (...roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    return next();
  },
}));

import stripeRouter from '../routes/stripe.js';
import { CheckoutError } from '../utils/CheckoutError.js';

const app = express();
app.use(express.json());
app.use('/api/stripe', stripeRouter);
app.use((error, req, res, next) => {
  void req;
  void next;
  return res.status(500).json({ message: error.message });
});

const endpoint = '/api/stripe/payment-intent';
const key = 'stripe-attempt-123';
const intentResponse = {
  paymentId: 'PAY-1',
  paymentIntentId: 'pi_test_123',
  clientSecret: 'pi_test_123_secret_mock',
  amount: 15000,
  currency: 'eur',
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.createCardPaymentIntent.mockResolvedValue({ ...intentResponse });
});

describe('POST /api/stripe/payment-intent — SCRUM-431', () => {
  it('creates a card payment for the authenticated member', async () => {
    const response = await request(app).post(endpoint).set('Idempotency-Key', key);
    expect(response.status).toBe(200);
    expect(response.body).toEqual(intentResponse);
    expect(mocks.createCardPaymentIntent).toHaveBeenCalledTimes(1);
    expect(mocks.createCardPaymentIntent).toHaveBeenCalledWith('member1', key);
  });

  it('returns 400 if Idempotency-Key is missing', async () => {
    const response = await request(app).post(endpoint);
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('INVALID_IDEMPOTENCY_KEY');
    expect(mocks.createCardPaymentIntent).not.toHaveBeenCalled();
  });

  it('returns 400 if Idempotency-Key is too long', async () => {
    const response = await request(app).post(endpoint).set('Idempotency-Key', 'a'.repeat(129));
    expect(response.status).toBe(400);
    expect(mocks.createCardPaymentIntent).not.toHaveBeenCalled();
  });

  it('returns 401 for an unauthenticated request', async () => {
    const response = await request(app).post(endpoint)
      .set('X-Test-Auth', 'missing')
      .set('Idempotency-Key', key);
    expect(response.status).toBe(401);
    expect(mocks.createCardPaymentIntent).not.toHaveBeenCalled();
  });

  it.each(['lender', 'admin'])('returns 403 for %s', async (role) => {
    const response = await request(app).post(endpoint)
      .set('X-Test-Role', role)
      .set('Idempotency-Key', key);
    expect(response.status).toBe(403);
    expect(mocks.createCardPaymentIntent).not.toHaveBeenCalled();
  });

  it('maps a checkout validation failure to its HTTP status', async () => {
    mocks.createCardPaymentIntent.mockRejectedValue(new CheckoutError(
      400, 'INVALID_PAYMENT_AMOUNT', 'Checkout amount is invalid',
    ));
    const response = await request(app).post(endpoint).set('Idempotency-Key', key);
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'INVALID_PAYMENT_AMOUNT',
      message: 'Checkout amount is invalid',
    });
  });

  it('forwards unexpected errors to Express error handling', async () => {
    mocks.createCardPaymentIntent.mockRejectedValue(new Error('Stripe unavailable'));
    const response = await request(app).post(endpoint).set('Idempotency-Key', key);
    expect(response.status).toBe(500);
    expect(response.body.message).toBe('Stripe unavailable');
  });
});
