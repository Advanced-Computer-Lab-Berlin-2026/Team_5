import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  finalizeCardPayment: vi.fn(),
}));

vi.mock('../config/stripe.js', () => ({
  default: { webhooks: { constructEvent: mocks.constructEvent } },
}));
vi.mock('../config/env.js', () => ({
  env: { stripeWebhookSecret: 'whsec_mock_test' },
}));
vi.mock('../services/stripeCheckoutService.js', () => ({
  finalizeCardPayment: mocks.finalizeCardPayment,
}));

import { env } from '../config/env.js';
import { handleStripeWebhook } from '../controllers/stripeWebhookController.js';

// IMPORTANT: express.raw must run before express.json() for Stripe signature verification.
const app = express();
app.post(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  handleStripeWebhook,
);
app.use(express.json());

const endpoint = '/api/stripe/webhook';
const signedBody = JSON.stringify({ id: 'evt_123', type: 'payment_intent.succeeded' });
const succeededIntent = {
  id: 'pi_123',
  metadata: { paymentId: 'PAY-1', userId: 'member1' },
};

function sendWebhook(signature = 't=123,v1=fake-for-mock') {
  return request(app)
    .post(endpoint)
    .set('Content-Type', 'application/json')
    .set('Stripe-Signature', signature)
    .send(signedBody);
}

beforeEach(() => {
  vi.resetAllMocks();
  env.stripeWebhookSecret = 'whsec_mock_test';
  mocks.finalizeCardPayment.mockResolvedValue({ status: 'completed' });
  mocks.constructEvent.mockReturnValue({
    type: 'payment_intent.succeeded',
    data: { object: succeededIntent },
  });
});

describe('POST /api/stripe/webhook — SCRUM-431', () => {
  it('passes the raw Buffer and signature to Stripe, and finalizes a successful payment', async () => {
    const response = await sendWebhook();
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true });
    expect(mocks.constructEvent).toHaveBeenCalledWith(
      expect.any(Buffer),
      't=123,v1=fake-for-mock',
      'whsec_mock_test',
    );
    expect(mocks.constructEvent.mock.calls[0][0].toString()).toBe(signedBody);
    expect(mocks.finalizeCardPayment).toHaveBeenCalledTimes(1);
    expect(mocks.finalizeCardPayment).toHaveBeenCalledWith(succeededIntent);
  });

  it('rejects an invalid Stripe signature with HTTP 400', async () => {
    mocks.constructEvent.mockImplementation(() => {
      throw new Error('Signature verification failed');
    });
    const response = await sendWebhook('invalid');
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Invalid Stripe webhook signature.');
    expect(mocks.finalizeCardPayment).not.toHaveBeenCalled();
  });

  it('returns 503 if webhook signing secret is missing', async () => {
    env.stripeWebhookSecret = undefined;
    const response = await sendWebhook();
    expect(response.status).toBe(503);
    expect(mocks.constructEvent).not.toHaveBeenCalled();
    expect(mocks.finalizeCardPayment).not.toHaveBeenCalled();
  });

  it('ignores successful Stripe payments unrelated to ShareShed', async () => {
    mocks.constructEvent.mockReturnValue({
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_unrelated', metadata: {} } },
    });
    const response = await sendWebhook();
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true, ignored: true });
    expect(mocks.finalizeCardPayment).not.toHaveBeenCalled();
  });

  it('acknowledges payment_intent.payment_failed without treating it as paid', async () => {
    mocks.constructEvent.mockReturnValue({
      type: 'payment_intent.payment_failed',
      data: { object: succeededIntent },
    });
    const response = await sendWebhook();
    expect(response.status).toBe(200);
    expect(mocks.finalizeCardPayment).not.toHaveBeenCalled();
  });

  it('acknowledges unrelated Stripe event types', async () => {
    mocks.constructEvent.mockReturnValue({
      type: 'charge.updated', data: { object: {} },
    });
    const response = await sendWebhook();
    expect(response.status).toBe(200);
    expect(mocks.finalizeCardPayment).not.toHaveBeenCalled();
  });

  it('returns 500 when finalization fails so Stripe can retry the event', async () => {
    mocks.finalizeCardPayment.mockRejectedValue(new Error('MongoDB temporarily unavailable'));
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await sendWebhook();
      expect(response.status).toBe(500);
      expect(response.body.message).toBe('Webhook processing failed.');
      expect(mocks.finalizeCardPayment).toHaveBeenCalledOnce();
    } finally {
      logSpy.mockRestore();
    }
  });

  it('acknowledges already processed successes', async () => {
    mocks.finalizeCardPayment.mockResolvedValue({ status: 'completed', reservations: ['RES-1'] });
    const response = await sendWebhook();
    expect(response.status).toBe(200);
    expect(mocks.finalizeCardPayment).toHaveBeenCalledOnce();
  });
});
