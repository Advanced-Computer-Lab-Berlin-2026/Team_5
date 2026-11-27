import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mocks = vi.hoisted(() => ({
  checkoutWithWallet: vi.fn(),
}));

vi.mock('../services/checkoutService.js', () => ({
  checkoutWithWallet: mocks.checkoutWithWallet,
}));

// This tests route wiring, not the real auth implementation.
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req, res, next) => {
    if (req.get('X-Test-Auth') === 'missing') {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    req.user = { id: 'member1', role: req.get('X-Test-Role') || 'member' };
    return next();
  },
  requireRole: (...allowedRoles) => (req, res, next) => {
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    return next();
  },
}));

// walletController imports User for the existing GET endpoint.
vi.mock('../models/User.js', () => ({ User: { findById: vi.fn() } }));

import walletRouter from '../routes/wallet.js';
import { CheckoutError } from '../utils/CheckoutError.js';

const app = express();
app.use(express.json());
app.use('/api/wallet', walletRouter);
app.use((error, req, res, next) => {
  void req;
  void next;
  return res.status(500).json({ message: error.message });
});

const endpoint = '/api/wallet/checkout';
const key = 'a-valid-checkout-key';
const checkoutResponse = {
  checkoutId: 'CHECKOUT-1',
  reservations: ['RES-1'],
  payments: ['PAY-1'],
  totalDeposit: 100,
  remainingBalance: 400,
  replayed: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkoutWithWallet.mockResolvedValue({ ...checkoutResponse });
});

describe('POST /api/wallet/checkout — SCRUM-428', () => {
  it('returns 201 with the completed checkout', async () => {
    const response = await request(app)
      .post(endpoint)
      .set('Idempotency-Key', key);
    expect(response.status).toBe(201);
    expect(response.body).toEqual(checkoutResponse);
    expect(mocks.checkoutWithWallet).toHaveBeenCalledWith('member1', key, null);
  });

  it('forwards a promo code from the request body', async () => {
    const response = await request(app)
      .post(endpoint)
      .set('Idempotency-Key', key)
      .send({ promoCode: 'SAVE20' });
    expect(response.status).toBe(201);
    expect(mocks.checkoutWithWallet).toHaveBeenCalledWith('member1', key, 'SAVE20');
  });

  it('returns 200 for an idempotent replay', async () => {
    mocks.checkoutWithWallet.mockResolvedValue({
      ...checkoutResponse, replayed: true,
    });
    const response = await request(app)
      .post(endpoint)
      .set('Idempotency-Key', key);
    expect(response.status).toBe(200);
    expect(response.body.replayed).toBe(true);
  });

  it('returns 400 when the Idempotency-Key header is missing', async () => {
    const response = await request(app).post(endpoint);
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('INVALID_IDEMPOTENCY_KEY');
    expect(mocks.checkoutWithWallet).not.toHaveBeenCalled();
  });

  it('returns 400 for an excessively long key', async () => {
    const response = await request(app)
      .post(endpoint)
      .set('Idempotency-Key', 'a'.repeat(129));
    expect(response.status).toBe(400);
    expect(mocks.checkoutWithWallet).not.toHaveBeenCalled();
  });

  it('returns 401 when unauthenticated', async () => {
    const response = await request(app)
      .post(endpoint)
      .set('X-Test-Auth', 'missing')
      .set('Idempotency-Key', key);
    expect(response.status).toBe(401);
    expect(mocks.checkoutWithWallet).not.toHaveBeenCalled();
  });

  it('lets a lender pay with their wallet', async () => {
    const response = await request(app)
      .post(endpoint)
      .set('X-Test-Role', 'lender')
      .set('Idempotency-Key', key);
    expect(response.status).toBe(201);
    expect(mocks.checkoutWithWallet).toHaveBeenCalledWith('member1', key, null);
  });

  it.each(['admin'])(
    'returns 403 for a %s', async (role) => {
      const response = await request(app)
        .post(endpoint)
        .set('X-Test-Role', role)
        .set('Idempotency-Key', key);
      expect(response.status).toBe(403);
      expect(mocks.checkoutWithWallet).not.toHaveBeenCalled();
    },
  );

  it('maps CheckoutError to the correct HTTP code and error code', async () => {
    mocks.checkoutWithWallet.mockRejectedValue(new CheckoutError(
      409, 'ITEM_ALREADY_RESERVED', 'Selected dates are unavailable.',
    ));
    const response = await request(app)
      .post(endpoint)
      .set('Idempotency-Key', key);
    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: 'ITEM_ALREADY_RESERVED',
      message: 'Selected dates are unavailable.',
    });
  });

  it('maps a duplicate-key conflict to 409', async () => {
    mocks.checkoutWithWallet.mockRejectedValue(Object.assign(
      new Error('Duplicate key'), { code: 11000 },
    ));
    const response = await request(app)
      .post(endpoint)
      .set('Idempotency-Key', key);
    expect(response.status).toBe(409);
    expect(response.body.error).toBe('CHECKOUT_CONFLICT');
  });

  it('asks the caller to retry a transient transaction failure', async () => {
    const error = new Error('Transient error');
    error.hasErrorLabel = (label) => label === 'TransientTransactionError';
    mocks.checkoutWithWallet.mockRejectedValue(error);
    const response = await request(app)
      .post(endpoint)
      .set('Idempotency-Key', key);
    expect(response.status).toBe(503);
    expect(response.body.error).toBe('CHECKOUT_RETRY');
  });

  it('forwards unexpected failures to the error handler', async () => {
    mocks.checkoutWithWallet.mockRejectedValue(new Error('Database failure'));
    const response = await request(app)
      .post(endpoint)
      .set('Idempotency-Key', key);
    expect(response.status).toBe(500);
    expect(response.body.message).toBe('Database failure');
  });
});
