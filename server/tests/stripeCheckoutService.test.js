import { beforeEach, describe, expect, it, vi } from 'vitest';

// These tests mock Stripe and MongoDB. No network or running database is required.
const mocks = vi.hoisted(() => ({
  paymentFindOne: vi.fn(),
  paymentCreate: vi.fn(),
  paymentFindById: vi.fn(),
  paymentFindOneAndUpdate: vi.fn(),
  paymentUpdateOne: vi.fn(),
  prepareCheckout: vi.fn(),
  lockAndCheckAvailability: vi.fn(),
  removeConflictingBorrowListEntries: vi.fn(),
  userFindById: vi.fn(),
  userUpdateOne: vi.fn(),
  itemFindById: vi.fn(),
  reservationCreate: vi.fn(),
  startSession: vi.fn(),
  intentCreate: vi.fn(),
  intentRetrieve: vi.fn(),
  refundCreate: vi.fn(),
  refundRetrieve: vi.fn(),
  refundList: vi.fn(),
  validatePromoCode: vi.fn(),
  recordPromoRedemption: vi.fn(),
}));

vi.mock('../config/stripe.js', () => ({
  default: {
    paymentIntents: { create: mocks.intentCreate, retrieve: mocks.intentRetrieve },
    refunds: {
      create: mocks.refundCreate,
      retrieve: mocks.refundRetrieve,
      list: mocks.refundList,
    },
  },
}));
vi.mock('../models/Payment.js', () => ({
  Payment: {
    findOne: mocks.paymentFindOne,
    create: mocks.paymentCreate,
    findById: mocks.paymentFindById,
    findOneAndUpdate: mocks.paymentFindOneAndUpdate,
    updateOne: mocks.paymentUpdateOne,
  },
}));
vi.mock('../models/User.js', () => ({
  User: { findById: mocks.userFindById, updateOne: mocks.userUpdateOne },
}));
vi.mock('../models/Item.js', () => ({ Item: { findById: mocks.itemFindById } }));
vi.mock('../models/Reservation.js', () => ({
  Reservation: { create: mocks.reservationCreate },
}));
vi.mock('mongoose', () => ({ default: { startSession: mocks.startSession } }));
vi.mock('../services/promoCodeService.js', () => ({
  validatePromoCode: mocks.validatePromoCode,
  recordPromoRedemption: mocks.recordPromoRedemption,
}));
vi.mock('../services/checkoutService.js', () => ({
  prepareCheckout: mocks.prepareCheckout,
  lockAndCheckAvailability: mocks.lockAndCheckAvailability,
  removeConflictingBorrowListEntries: mocks.removeConflictingBorrowListEntries,
}));

import {
  createCardPaymentIntent,
  finalizeCardPayment,
} from '../services/stripeCheckoutService.js';
import { CheckoutError } from '../utils/CheckoutError.js';

const USER = 'member1';
const KEY = 'checkout-key-123';
const START = new Date('2027-04-10T00:00:00.000Z');
const END = new Date('2027-04-15T00:00:00.000Z');

const checkoutItems = [
  { itemId: 'ITM-1', lenderId: 'lender1', startDate: START, endDate: END, depositAmount: 100 },
  { itemId: 'ITM-2', lenderId: 'lender2', startDate: START, endDate: END, depositAmount: 50 },
];

const pendingPayment = () => ({
  _id: 'PAY-1',
  user: USER,
  type: 'deposit-pending',
  amount: 150,
  direction: 'deduct',
  method: 'card',
  status: 'awaiting_payment',
  checkoutKey: KEY,
  stripeAmountCents: 15000,
  stripePaymentIntentId: 'pi_test_123',
  checkoutItems: checkoutItems.map((item) => ({ ...item })),
  reservations: [],
  createdAt: new Date(),
});

const stripeIntent = (overrides = {}) => ({
  id: 'pi_test_123',
  status: 'succeeded',
  livemode: false,
  currency: 'eur',
  amount: 15000,
  amount_received: 15000,
  metadata: { paymentId: 'PAY-1', userId: USER, checkoutKey: KEY },
  client_secret: 'pi_test_123_secret_dummy',
  ...overrides,
});

const pendingPromoPayment = () => ({
  ...pendingPayment(),
  amount: 135,
  stripeAmountCents: 13500,
  promoCode: 'SAVE10',
  originalTotal: 150,
  promoDiscountPercent: 10,
  promoLowestItemDeposit: 50,
  checkoutItems: checkoutItems.map(item => ({ ...item, depositAmount: item.depositAmount * 0.9 })),
});

const promoIntent = (overrides = {}) => stripeIntent({
  amount: 13500,
  amount_received: 13500,
  ...overrides,
});

// Payment.findById is awaited once, and then used with .session() in the transaction.
function sessionAwareQuery(value) {
  return {
    session: vi.fn(async () => value),
    then(resolve, reject) {
      return Promise.resolve(value).then(resolve, reject);
    },
  };
}

let session;
let currentPayment;

beforeEach(() => {
  vi.resetAllMocks();

  currentPayment = pendingPayment();
  session = {
    inTransaction: vi.fn(() => true),
    withTransaction: vi.fn(async (callback) => callback()),
    endSession: vi.fn().mockResolvedValue(undefined),
  };
  mocks.startSession.mockResolvedValue(session);

  mocks.paymentFindOne.mockResolvedValue(null);
  mocks.paymentCreate.mockImplementation(async (fields) => ({
    ...fields,
    _id: 'PAY-1',
    createdAt: new Date(),
  }));
  mocks.paymentFindById.mockImplementation(() => sessionAwareQuery(currentPayment));
  mocks.paymentFindOneAndUpdate.mockResolvedValue({ ...currentPayment, stripePaymentIntentId: 'pi_test_123' });
  mocks.paymentUpdateOne.mockResolvedValue({ modifiedCount: 1 });

  mocks.prepareCheckout.mockResolvedValue(checkoutItems.map((item) => ({ ...item })));
  mocks.lockAndCheckAvailability.mockResolvedValue(checkoutItems);
  mocks.removeConflictingBorrowListEntries.mockResolvedValue(undefined);
  mocks.userFindById.mockImplementation((id) => ({
    session: async () => id === USER
      ? { _id: USER, role: 'member', suspended: false }
      : { _id: id, suspended: false },
  }));
  mocks.itemFindById.mockImplementation((id) => ({
    session: async () => ({
      _id: id,
      owner: id === 'ITM-1' ? 'lender1' : 'lender2',
      archived: false,
      flagged: false,
    }),
  }));
  mocks.userUpdateOne.mockResolvedValue({ modifiedCount: 1 });

  let reservationSequence = 0;
  mocks.reservationCreate.mockImplementation(async ([data]) => [{
    _id: `RES-${++reservationSequence}`,
    ...data,
  }]);

  mocks.intentCreate.mockResolvedValue(stripeIntent({ status: 'requires_payment_method' }));
  mocks.intentRetrieve.mockResolvedValue(stripeIntent({ status: 'requires_payment_method' }));
  mocks.refundList.mockResolvedValue({ data: [] });
  mocks.refundCreate.mockResolvedValue({
    id: 're_test_1',
    amount: 15000,
    status: 'succeeded',
  });
  mocks.refundRetrieve.mockResolvedValue({
    id: 're_test_1',
    amount: 15000,
    status: 'succeeded',
  });
});

describe('createCardPaymentIntent — SCRUM-431', () => {
  it('rejects an absent idempotency key', async () => {
    await expect(createCardPaymentIntent(USER, '')).rejects.toMatchObject({
      code: 'INVALID_IDEMPOTENCY_KEY',
      statusCode: 400,
    });
    expect(mocks.prepareCheckout).not.toHaveBeenCalled();
  });

  it('creates a pending Payment and a €150 PaymentIntent (15000 cents)', async () => {
    const result = await createCardPaymentIntent(USER, KEY);

    expect(mocks.prepareCheckout).toHaveBeenCalledWith(USER);
    expect(mocks.paymentCreate).toHaveBeenCalledWith(expect.objectContaining({
      user: USER,
      type: 'deposit-pending',
      status: 'awaiting_payment',
      method: 'card',
      amount: 150,
      stripeAmountCents: 15000,
      checkoutKey: KEY,
      checkoutItems: expect.arrayContaining([
        expect.objectContaining({ itemId: 'ITM-1', depositAmount: 100 }),
        expect.objectContaining({ itemId: 'ITM-2', depositAmount: 50 }),
      ]),
    }));
    expect(mocks.intentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 15000,
        currency: 'eur',
        metadata: expect.objectContaining({ paymentId: 'PAY-1', userId: USER }),
      }),
      { idempotencyKey: 'shareshed-card-PAY-1' },
    );
    expect(mocks.paymentFindOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'PAY-1' }),
      { $set: { stripePaymentIntentId: 'pi_test_123' } },
      { new: true },
    );
    expect(result).toEqual({
      paymentId: 'PAY-1',
      paymentIntentId: 'pi_test_123',
      clientSecret: 'pi_test_123_secret_dummy',
      amount: 15000,
      currency: 'eur',
    });
  });

  it('saves a discounted quote without redeeming when creating the intent', async () => {
    mocks.validatePromoCode.mockResolvedValue({ valid: true, discountPercent: 10 });
    mocks.intentCreate.mockResolvedValueOnce(promoIntent({ status: 'requires_payment_method' }));

    await expect(createCardPaymentIntent(USER, KEY, 'save10')).resolves
      .toMatchObject({ amount: 13500 });

    expect(mocks.paymentCreate).toHaveBeenCalledWith(expect.objectContaining({
      amount: 135, stripeAmountCents: 13500, promoCode: 'SAVE10',
      originalTotal: 150, promoDiscountPercent: 10, promoLowestItemDeposit: 50,
    }));
    expect(mocks.recordPromoRedemption).not.toHaveBeenCalled();
  });

  it('reuses an existing PaymentIntent without rereading the borrow list', async () => {
    mocks.paymentFindOne.mockResolvedValue(pendingPayment());

    const result = await createCardPaymentIntent(USER, KEY);

    expect(result.paymentIntentId).toBe('pi_test_123');
    expect(mocks.intentRetrieve).toHaveBeenCalledWith('pi_test_123');
    expect(mocks.paymentCreate).not.toHaveBeenCalled();
    expect(mocks.prepareCheckout).not.toHaveBeenCalled();
    expect(mocks.intentCreate).not.toHaveBeenCalled();
  });

  it('recovers a concurrent duplicate-key insert by loading its Payment', async () => {
    mocks.paymentCreate.mockRejectedValue(Object.assign(new Error('duplicate'), { code: 11000 }));
    mocks.paymentFindOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(pendingPayment());

    const result = await createCardPaymentIntent(USER, KEY);

    expect(result.paymentId).toBe('PAY-1');
    expect(mocks.intentRetrieve).toHaveBeenCalledWith('pi_test_123');
    expect(mocks.intentCreate).not.toHaveBeenCalled();
  });

  it('rejects attempts to restart an already completed card payment', async () => {
    mocks.paymentFindOne.mockResolvedValue({ ...pendingPayment(), status: 'completed' });
    await expect(createCardPaymentIntent(USER, KEY)).rejects.toMatchObject({
      code: 'PAYMENT_NOT_PENDING',
    });
    expect(mocks.intentCreate).not.toHaveBeenCalled();
  });

  it('refuses to recreate an unlinked PaymentIntent after the retry window', async () => {
    mocks.paymentFindOne.mockResolvedValue({
      ...pendingPayment(),
      stripePaymentIntentId: undefined,
      createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });
    await expect(createCardPaymentIntent(USER, KEY)).rejects.toMatchObject({
      code: 'PAYMENT_REQUIRES_RECONCILIATION',
    });
    expect(mocks.intentCreate).not.toHaveBeenCalled();
  });

  it('rejects amounts below Stripe’s €0.50 minimum', async () => {
    mocks.prepareCheckout.mockResolvedValue([{ ...checkoutItems[0], depositAmount: 0.25 }]);
    await expect(createCardPaymentIntent(USER, KEY)).rejects.toMatchObject({
      code: 'INVALID_PAYMENT_AMOUNT',
    });
    expect(mocks.paymentCreate).not.toHaveBeenCalled();
  });

  it('rejects invalid negative item deposits', async () => {
    mocks.prepareCheckout.mockResolvedValue([{ ...checkoutItems[0], depositAmount: -1 }]);
    await expect(createCardPaymentIntent(USER, KEY)).rejects.toThrow('Invalid deposit');
    expect(mocks.paymentCreate).not.toHaveBeenCalled();
  });

  it('rejects a Stripe PaymentIntent with a mismatched amount', async () => {
    mocks.paymentFindOne.mockResolvedValue(pendingPayment());
    mocks.intentRetrieve.mockResolvedValue(stripeIntent({
      status: 'requires_payment_method', amount: 14999,
    }));
    await expect(createCardPaymentIntent(USER, KEY)).rejects.toThrow('mismatch');
  });

  it('refuses a succeeded PaymentIntent as a new confirmable attempt', async () => {
    mocks.paymentFindOne.mockResolvedValue(pendingPayment());
    mocks.intentRetrieve.mockResolvedValue(stripeIntent());
    await expect(createCardPaymentIntent(USER, KEY)).rejects.toMatchObject({
      code: 'PAYMENT_NOT_CONFIRMABLE',
    });
  });
});

describe('finalizeCardPayment — SCRUM-431', () => {
  it('creates pending reservations and completes one aggregate card payment', async () => {
    const result = await finalizeCardPayment(stripeIntent());

    expect(result).toEqual({
      status: 'completed', paymentId: 'PAY-1', reservations: ['RES-1', 'RES-2'],
    });
    expect(mocks.lockAndCheckAvailability).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ itemId: 'ITM-1', depositAmount: 100 }),
        expect.objectContaining({ itemId: 'ITM-2', depositAmount: 50 }),
      ]),
      session,
    );
    expect(mocks.reservationCreate).toHaveBeenCalledTimes(2);
    expect(mocks.reservationCreate).toHaveBeenNthCalledWith(1,
      [expect.objectContaining({
        item: 'ITM-1', borrower: USER, status: 'pending',
        payment: {
          depositAmount: 100,
          method: 'card',
          stripePaymentIntentId: 'pi_test_123',
        },
      })],
      { session },
    );
    expect(mocks.reservationCreate).toHaveBeenNthCalledWith(2,
      [expect.objectContaining({
        item: 'ITM-2', borrower: USER, status: 'pending',
        payment: {
          depositAmount: 50,
          method: 'card',
          stripePaymentIntentId: 'pi_test_123',
        },
      })],
      { session },
    );
    expect(mocks.paymentUpdateOne).toHaveBeenCalledWith(
      { _id: 'PAY-1', status: 'awaiting_payment' },
      { $set: { type: 'deposit-paid', status: 'completed', reservations: ['RES-1', 'RES-2'] } },
      { session },
    );
    expect(mocks.userUpdateOne).toHaveBeenCalledTimes(2);
    expect(mocks.removeConflictingBorrowListEntries).toHaveBeenCalledWith(
      expect.any(Array), USER, session,
    );
    expect(session.endSession).toHaveBeenCalledOnce();
    expect(mocks.refundCreate).not.toHaveBeenCalled();
    expect(mocks.recordPromoRedemption).not.toHaveBeenCalled();
  });

  it('redeems from saved Stripe pricing once across a successful webhook replay', async () => {
    currentPayment = pendingPromoPayment();

    const result = await finalizeCardPayment(promoIntent());
    expect(result).toEqual({ status: 'completed', paymentId: 'PAY-1', reservations: ['RES-1', 'RES-2'] });
    expect(mocks.recordPromoRedemption).toHaveBeenCalledWith({
      promoCode: 'SAVE10', userId: USER, paymentId: 'PAY-1',
      paymentIds: ['PAY-1'], reservationIds: ['RES-1', 'RES-2'], session,
      pricing: { originalTotal: 150, totalDeposit: 135, discountPercent: 10, lowestItemDeposit: 50 },
    });

    currentPayment = { ...currentPayment, status: 'completed', reservations: result.reservations };
    await expect(finalizeCardPayment(promoIntent())).resolves.toEqual(result);
    expect(mocks.recordPromoRedemption).toHaveBeenCalledOnce();
    expect(mocks.validatePromoCode).not.toHaveBeenCalled();
  });

  it.each(['PROMO_EXPIRED', 'PROMO_USAGE_LIMIT_REACHED', 'PROMO_NO_LONGER_VALID'])(
    'refunds a verified card charge when redemption fails with %s',
    async (code) => {
      currentPayment = pendingPromoPayment();
      mocks.recordPromoRedemption.mockRejectedValue(new CheckoutError(409, code, 'Promo failed.'));
      mocks.paymentFindOneAndUpdate.mockResolvedValue({ ...currentPayment, status: 'refund_pending' });
      mocks.refundCreate.mockResolvedValue({ id: 're_test_1', amount: 13500, status: 'succeeded' });

      await expect(finalizeCardPayment(promoIntent())).resolves.toEqual({
        status: 'refunded', paymentId: 'PAY-1', refundId: 're_test_1',
      });
      expect(mocks.recordPromoRedemption).toHaveBeenCalledOnce();
      expect(mocks.refundCreate).toHaveBeenCalledWith(
        expect.objectContaining({ payment_intent: 'pi_test_123' }),
        { idempotencyKey: 'shareshed-unavailable-refund-PAY-1' },
      );
    },
  );

  it('does not redeem a promo for a card intent that has not succeeded', async () => {
    currentPayment = pendingPromoPayment();

    await expect(finalizeCardPayment(promoIntent({ status: 'requires_payment_method' })))
      .rejects.toThrow('Stripe payment verification failed.');
    expect(mocks.recordPromoRedemption).not.toHaveBeenCalled();
    expect(mocks.paymentUpdateOne).not.toHaveBeenCalled();
    expect(mocks.refundCreate).not.toHaveBeenCalled();
  });

  it('does not recreate reservations for a completed payment (duplicate webhook)', async () => {
    currentPayment = { ...pendingPayment(), status: 'completed', reservations: ['RES-EXISTING'] };

    expect(await finalizeCardPayment(stripeIntent())).toEqual({
      status: 'completed', paymentId: 'PAY-1', reservations: ['RES-EXISTING'],
    });
    expect(mocks.startSession).not.toHaveBeenCalled();
    expect(mocks.reservationCreate).not.toHaveBeenCalled();
  });

  it('also checks completed status inside the transaction', async () => {
    mocks.paymentFindById
      .mockImplementationOnce(() => sessionAwareQuery(pendingPayment()))
      .mockImplementationOnce(() => sessionAwareQuery({
        ...pendingPayment(), status: 'completed', reservations: ['RES-EXISTING'],
      }));

    const result = await finalizeCardPayment(stripeIntent());
    expect(result.status).toBe('completed');
    expect(result.reservations).toEqual(['RES-EXISTING']);
    expect(mocks.reservationCreate).not.toHaveBeenCalled();
  });

  it.each([
    ['wrong amount', { amount_received: 14999 }],
    ['wrong currency', { currency: 'usd' }],
    ['not succeeded', { status: 'processing' }],
    ['live mode', { livemode: true }],
    ['wrong intent ID', { id: 'pi_wrong' }],
    ['wrong owner', { metadata: { paymentId: 'PAY-1', userId: 'another-member' } }],
  ])('rejects Stripe verification failure: %s', async (_label, overrides) => {
    await expect(finalizeCardPayment(stripeIntent(overrides)))
      .rejects.toThrow('Stripe payment verification failed');
    expect(mocks.startSession).not.toHaveBeenCalled();
    expect(mocks.reservationCreate).not.toHaveBeenCalled();
  });

  it('rejects a corrupted saved amount without creating reservations or refunding', async () => {
    currentPayment = { ...pendingPayment(), stripeAmountCents: 14999 };
    // Verification fails before we ever write anything.
    await expect(finalizeCardPayment(stripeIntent())).rejects.toThrow('Stripe payment verification failed');
    expect(mocks.reservationCreate).not.toHaveBeenCalled();
    expect(mocks.refundCreate).not.toHaveBeenCalled();
  });

  it('refunds an unavailable reservation rather than keeping the card payment', async () => {
    mocks.lockAndCheckAvailability.mockRejectedValue(new CheckoutError(
      409, 'ITEM_ALREADY_RESERVED', 'Dates are unavailable',
    ));
    mocks.paymentFindOneAndUpdate.mockResolvedValue({ ...pendingPayment(), status: 'refund_pending' });

    const result = await finalizeCardPayment(stripeIntent());

    expect(result).toEqual({ status: 'refunded', paymentId: 'PAY-1', refundId: 're_test_1' });
    expect(mocks.reservationCreate).not.toHaveBeenCalled();
    expect(mocks.refundCreate).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: 'pi_test_123' }),
      { idempotencyKey: 'shareshed-unavailable-refund-PAY-1' },
    );
    expect(mocks.paymentUpdateOne).toHaveBeenCalledWith(
      { _id: 'PAY-1', status: 'refund_pending' },
      expect.objectContaining({ $set: expect.objectContaining({ status: 'refunded', stripeRefundId: 're_test_1' }) }),
    );
    expect(session.endSession).toHaveBeenCalledOnce();
  });

  it('refunds an item that changes owner before finalization', async () => {
    mocks.itemFindById.mockImplementation((id) => ({
      session: async () => ({ _id: id, owner: 'someone-else', archived: false, flagged: false }),
    }));
    mocks.paymentFindOneAndUpdate.mockResolvedValue({ ...pendingPayment(), status: 'refund_pending' });

    const result = await finalizeCardPayment(stripeIntent());
    expect(result.status).toBe('refunded');
    expect(mocks.refundCreate).toHaveBeenCalledOnce();
  });

  it('returns a previously completed refund without creating a second one', async () => {
    currentPayment = { ...pendingPayment(), status: 'refunded' };
    const result = await finalizeCardPayment(stripeIntent());
    expect(result).toEqual({ status: 'refunded', paymentId: 'PAY-1' });
    expect(mocks.refundCreate).not.toHaveBeenCalled();
    expect(mocks.startSession).not.toHaveBeenCalled();
  });

  it('reuses a refund already associated with the Payment', async () => {
    currentPayment = { ...pendingPayment(), status: 'refund_pending', stripeRefundId: 're_test_1' };
    mocks.paymentFindOneAndUpdate.mockResolvedValue(null);
    const result = await finalizeCardPayment(stripeIntent());
    expect(result.status).toBe('refunded');
    expect(mocks.refundRetrieve).toHaveBeenCalledWith('re_test_1');
    expect(mocks.refundCreate).not.toHaveBeenCalled();
  });

  it('propagates temporary database errors, allowing the webhook to retry', async () => {
    mocks.lockAndCheckAvailability.mockRejectedValue(new Error('MongoDB write conflict'));
    await expect(finalizeCardPayment(stripeIntent())).rejects.toThrow('MongoDB write conflict');
    expect(mocks.refundCreate).not.toHaveBeenCalled();
    expect(mocks.reservationCreate).not.toHaveBeenCalled();
    expect(session.endSession).toHaveBeenCalledOnce();
  });

  it('rejects a pending refund until Stripe reports success', async () => {
    currentPayment = { ...pendingPayment(), status: 'refund_pending', stripeRefundId: 're_test_1' };
    mocks.paymentFindOneAndUpdate.mockResolvedValue(null);
    mocks.refundRetrieve.mockResolvedValue({ id: 're_test_1', status: 'pending' });
    await expect(finalizeCardPayment(stripeIntent())).rejects.toThrow('refund is pending');
    expect(mocks.refundCreate).not.toHaveBeenCalled();
  });
});
