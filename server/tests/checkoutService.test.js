import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MongoClient, MongoServerError } from 'mongodb';
import { CheckoutError } from '../utils/CheckoutError.js';
import { Category } from '../models/Category.js';
import { FriendLink } from '../models/FriendLink.js';
import { MembershipTier } from '../models/MembershipTier.js';
import { Reservation } from '../models/Reservation.js';

// These are unit-test doubles. No MongoDB connection is required.
const db = vi.hoisted(() => ({
  startSession: vi.fn(),
  userFindById: vi.fn(),
  userFindOneAndUpdate: vi.fn(),
  userUpdateOne: vi.fn(),
  userUpdateMany: vi.fn(),
  itemFindById: vi.fn(),
  itemFindOneAndUpdate: vi.fn(),
  reservationFindOverlap: vi.fn(),
  reservationCreate: vi.fn(),
  paymentCreate: vi.fn(),
  checkoutFindOne: vi.fn(),
  checkoutCreate: vi.fn(),
  validatePromoCode: vi.fn(),
  recordPromoRedemption: vi.fn(),
}));

vi.mock('mongoose', () => ({
  default: { startSession: db.startSession },
}));
vi.mock('../models/Category.js', () => ({ Category: { findById: vi.fn() } }));
vi.mock('../models/FriendLink.js', () => ({ FriendLink: { find: vi.fn() } }));
vi.mock('../models/MembershipTier.js', () => ({ MembershipTier: { find: vi.fn(), findById: vi.fn() } }));
vi.mock('../services/promoCodeService.js', () => ({
  validatePromoCode: db.validatePromoCode,
  recordPromoRedemption: db.recordPromoRedemption,
}));
vi.mock('../models/User.js', () => ({
  User: {
    findById: db.userFindById,
    find: vi.fn(() => ({ lean: async () => [{ membership: { tier: 'Plus' } }] })),
    findOneAndUpdate: db.userFindOneAndUpdate,
    updateOne: db.userUpdateOne,
    updateMany: db.userUpdateMany,
  },
}));
vi.mock('../models/Item.js', () => ({
  Item: {
    findById: db.itemFindById,
    findOneAndUpdate: db.itemFindOneAndUpdate,
  },
}));
vi.mock('../models/Reservation.js', () => ({
  Reservation: {
    findOverlap: db.reservationFindOverlap,
    countDocuments: vi.fn(() => 0),
    create: db.reservationCreate,
  },
}));
vi.mock('../models/Payment.js', () => ({
  Payment: { create: db.paymentCreate },
}));
vi.mock('../models/Checkout.js', () => ({
  Checkout: {
    findOne: db.checkoutFindOne,
    create: db.checkoutCreate,
  },
}));

import {
  acquireCheckoutLock,
  checkoutWithWallet,
  lockAndCheckAvailability,
  prepareCheckout,
  validateBorrowList,
} from '../services/checkoutService.js';

const dates = {
  startDate: new Date('2027-04-10T00:00:00.000Z'),
  endDate: new Date('2027-04-15T00:00:00.000Z'),
};

let session;
let borrowList;
let items;

// Checkout.findOne() is used both as an awaitable query and with .session().
function checkoutQuery(value) {
  return {
    session: vi.fn(async () => value),
    then(resolve, reject) {
      return Promise.resolve(value).then(resolve, reject);
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.validatePromoCode.mockReset();
  db.recordPromoRedemption.mockReset();
  FriendLink.find.mockReturnValue({ lean: async () => [] });
  MembershipTier.find.mockReturnValue({ lean: async () => [] });
  Category.findById.mockReturnValue({ lean: async () => null });

  session = {
    inTransaction: vi.fn(() => true),
    withTransaction: vi.fn(async (callback) => callback()),
    endSession: vi.fn().mockResolvedValue(undefined),
  };
  db.startSession.mockResolvedValue(session);

  borrowList = [{ item: 'ITM-1', ...dates }];
  items = {
    'ITM-1': {
      _id: 'ITM-1',
      owner: 'lender1',
      archived: false,
      flagged: false,
      depositAmount: 100,
    },
  };

  // Both borrower and lender are loaded through User.findById().select().session().
  db.userFindById.mockImplementation((id) => ({
    select: () => ({
      session: async () => (id === 'member1'
        ? { _id: id, borrow_list: borrowList, trustScore: 50 }
        : { suspended: false }),
    }),
  }));
  db.itemFindById.mockImplementation((id) => ({
    session: async () => items[id] ?? null,
  }));
  db.itemFindOneAndUpdate.mockImplementation(async (filter) =>
    items[filter._id] ?? null);

  db.reservationFindOverlap.mockResolvedValue(null);
  db.checkoutFindOne.mockImplementation(() => checkoutQuery(null));
  db.userFindOneAndUpdate.mockResolvedValue({ wallet: 400 });
  db.userUpdateOne.mockResolvedValue({ modifiedCount: 1 });
  db.userUpdateMany.mockResolvedValue({ modifiedCount: 0 });

  let reservationNumber = 0;
  let paymentNumber = 0;
  db.reservationCreate.mockImplementation(async ([data]) => [{
    _id: `RES-${++reservationNumber}`,
    ...data,
  }]);
  db.paymentCreate.mockImplementation(async ([data]) => [{
    _id: `PAY-${++paymentNumber}`,
    ...data,
  }]);
  db.checkoutCreate.mockImplementation(async ([data]) => [{
    _id: 'CHECKOUT-1',
    ...data,
  }]);
});

describe('validateBorrowList', () => {
  it('accepts a valid entry', () => {
    expect(validateBorrowList(borrowList)).toBe(true);
  });

  it('rejects an empty borrow list with a 400 error', () => {
    try {
      validateBorrowList([]);
      throw new Error('Expected validation to fail');
    } catch (error) {
      expect(error).toMatchObject({
        statusCode: 400, code: 'EMPTY_BORROW_LIST',
      });
    }
  });

  it.each([
    [{ item: 'ITM-1', startDate: null, endDate: dates.endDate }],
    [{ item: 'ITM-1', startDate: 'not-a-date', endDate: dates.endDate }],
    [{ item: 'ITM-1', startDate: dates.endDate, endDate: dates.startDate }],
  ])('rejects an invalid or reversed date range', (entries) => {
    expect(() => validateBorrowList(entries)).toThrow();
  });

  it('rejects duplicate item IDs', () => {
    expect(() => validateBorrowList([...borrowList, ...borrowList])).toThrow(
      'Duplicate item',
    );
  });
});

describe('availability and locks — SCRUM-425', () => {
  it('requires an active transaction', async () => {
    await expect(acquireCheckoutLock('ITM-1', null)).rejects.toThrow(
      'active transaction',
    );
    expect(db.itemFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('increments checkoutVersion with the same transaction session', async () => {
    await acquireCheckoutLock('ITM-1', session);
    expect(db.itemFindOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'ITM-1', archived: false, flagged: { $ne: true } },
      { $inc: { checkoutVersion: 1 } },
      { new: true, session },
    );
  });

  it('rejects a pending/upcoming/active overlap with 409', async () => {
    db.reservationFindOverlap.mockResolvedValue({ _id: 'RES-EXISTING' });
    const checkoutItems = [{ itemId: 'ITM-1', lenderId: 'lender1', ...dates }];

    await expect(lockAndCheckAvailability(checkoutItems, session))
      .rejects.toMatchObject({ statusCode: 409, code: 'ITEM_ALREADY_RESERVED' });
    expect(db.reservationFindOverlap).toHaveBeenCalledWith(
      'ITM-1', dates.startDate, dates.endDate, session,
    );
  });

  it('locks multiple items in a deterministic ID order', async () => {
    items['ITM-2'] = { ...items['ITM-1'], _id: 'ITM-2' };
    const checkoutItems = [
      { itemId: 'ITM-2', ...dates },
      { itemId: 'ITM-1', ...dates },
    ];
    const ordered = await lockAndCheckAvailability(checkoutItems, session);
    expect(ordered.map((item) => item.itemId)).toEqual(['ITM-1', 'ITM-2']);
    expect(db.itemFindOneAndUpdate.mock.calls.map(([filter]) => filter._id))
      .toEqual(['ITM-1', 'ITM-2']);
  });
});

describe('prepareCheckout — SCRUM-424', () => {
  it.each([
    [{ maxDurationDays: 4 }, 'BORROW_DURATION_EXCEEDED'],
    [{ minTrustScore: 51 }, 'MINIMUM_TRUST_SCORE'],
  ])('rejects entries that violate item borrowing rules', async (borrowingRules, code) => {
    items['ITM-1'].borrowingRules = borrowingRules;
    await expect(checkoutWithWallet('member1', 'rules')).rejects.toMatchObject({ code });
    expect(db.userFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('applies the category multiplier and accepted household discount before charging the wallet', async () => {
    items['ITM-1'].category = 'Tools';
    Category.findById.mockReturnValue({ lean: async () => ({ depositMultiplier: 1.5 }) });
    FriendLink.find.mockReturnValue({ lean: async () => [{ requester: 'member1', recipient: 'housemate' }] });
    MembershipTier.find.mockReturnValue({ lean: async () => [{ deposit_discount: 10 }] });

    await checkoutWithWallet('member1', 'discount');

    expect(db.userFindOneAndUpdate).toHaveBeenCalledWith(
      expect.anything(), { $inc: { wallet: -135 } }, expect.anything()
    );
    expect(db.reservationCreate.mock.calls[0][0][0].payment).toMatchObject({
      depositAmount: 135, discountPercent: 10,
    });
  });
  it('constructs entries using server-side item prices and lender IDs', async () => {
    const result = await prepareCheckout('member1', session);
    expect(result).toEqual([{
      itemId: 'ITM-1',
      lenderId: 'lender1',
      ...dates,
      depositAmount: 100,
      cancellationPolicy: {
          freeDays: 0,
          forfeitPercent: 0
      }
  }]);
  });

  it.each([
    ['archived', { archived: true }],
    ['flagged', { flagged: true }],
  ])('rejects an %s item', async (_name, changes) => {
    items['ITM-1'] = { ...items['ITM-1'], ...changes };
    await expect(prepareCheckout('member1', session)).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it('rejects own-item borrowing', async () => {
    items['ITM-1'].owner = 'member1';
    await expect(prepareCheckout('member1', session)).rejects.toThrow(
      'cannot borrow their own item',
    );
  });

  it('rejects an overlapping reservation with 409 (after removing the redundant pre-check)', async () => {
    db.reservationFindOverlap.mockResolvedValue({ _id: 'RES-OLD' });
    // A pre-check is intentionally not required here: the test verifies the
    // actual checkout path returns 409 rather than a generic 500.
    await expect(checkoutWithWallet('member1', 'key-overlap')).rejects.toMatchObject({
      statusCode: 409,
      code: 'ITEM_ALREADY_RESERVED',
    });
    expect(db.userFindOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('checkoutWithWallet — SCRUM-424 / SCRUM-428', () => {
  it('declines a checkout that exceeds the configured limit before debiting', async () => {
    MembershipTier.findById.mockResolvedValueOnce({ maxConcurrentReservations: 2 });
    Reservation.countDocuments.mockResolvedValueOnce(2);

    await expect(checkoutWithWallet('member1', 'over-limit')).rejects.toMatchObject({ code: 'MEMBERSHIP_RESERVATION_LIMIT' });
    expect(db.userFindOneAndUpdate).not.toHaveBeenCalled();
    expect(db.paymentCreate).not.toHaveBeenCalled();
  });
  it('debits once, creates a pending reservation and payment, and saves checkout', async () => {
    const result = await checkoutWithWallet('member1', 'key-1');

    expect(result).toMatchObject({
      checkoutId: 'CHECKOUT-1',
      totalDeposit: 100,
      remainingBalance: 400,
      replayed: false,
      reservations: ['RES-1'],
      payments: ['PAY-1'],
    });
    expect(db.userFindOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: 'member1', role: { $in: ['member', 'lender'] }, suspended: { $ne: true },
        wallet: { $gte: 100 },
      },
      { $inc: { wallet: -100 } },
      { new: true, session },
    );
    expect(db.reservationCreate).toHaveBeenCalledWith(
      [expect.objectContaining({
        borrower: 'member1', lender: 'lender1', status: 'pending',
        payment: { depositAmount: 100, method: 'wallet' },
      })],
      { session },
    );
    expect(db.paymentCreate).toHaveBeenCalledWith(
      [expect.objectContaining({
        user: 'member1', reservation: 'RES-1',
        type: 'deposit-paid', amount: 100,
        direction: 'deduct', method: 'wallet',
      })],
      { session },
    );
    expect(db.userUpdateOne).toHaveBeenCalledWith(
      { _id: 'member1' }, { $set: { borrow_list: [] } }, { session },
    );
    expect(db.checkoutCreate).toHaveBeenCalledWith(
      [expect.objectContaining({
        user: 'member1', idempotencyKey: 'key-1',
        method: 'wallet', totalDeposit: 100,
        reservations: ['RES-1'], payments: ['PAY-1'],
      })],
      { session },
    );
    expect(session.endSession).toHaveBeenCalledTimes(1);
    expect(db.validatePromoCode).not.toHaveBeenCalled();
    expect(db.recordPromoRedemption).not.toHaveBeenCalled();
  });

  it('handles multiple items with one total wallet debit', async () => {
    borrowList.push({ item: 'ITM-2', ...dates });
    items['ITM-2'] = {
      _id: 'ITM-2', owner: 'lender1', archived: false,
      flagged: false, depositAmount: 50,
    };
    const result = await checkoutWithWallet('member1', 'key-2');
    expect(result.totalDeposit).toBe(150);
    expect(result.reservations).toHaveLength(2);
    expect(result.payments).toHaveLength(2);
    expect(db.userFindOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(db.reservationCreate).toHaveBeenCalledTimes(2);
    expect(db.paymentCreate).toHaveBeenCalledTimes(2);
  });

  it('charges pickup and delivery items together while keeping fees separate from deposits', async () => {
    borrowList.push({ item: 'ITM-2', ...dates, deliveryAddress: '10 Main Street' });
    items['ITM-2'] = {
      _id: 'ITM-2', owner: 'lender1', depositAmount: 50,
      delivery: { offered: true, fee: 12.5 },
    };

    const result = await checkoutWithWallet('member1', 'mixed-delivery');

    expect(result).toMatchObject({ totalDeposit: 150, deliveryFee: 12.5, total: 162.5 });
    expect(db.userFindOneAndUpdate).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ wallet: { $gte: 162.5 } }), { $inc: { wallet: -162.5 } }, expect.anything()
    );
    expect(db.reservationCreate).toHaveBeenLastCalledWith([expect.objectContaining({
      delivery: { address: '10 Main Street', fee: 12.5, status: 'preparing', feeCollected: true },
      payment: { depositAmount: 50, method: 'wallet' }
    })], { session });
    expect(db.paymentCreate).toHaveBeenLastCalledWith([expect.objectContaining({
      type: 'delivery-fee', reservation: 'RES-2', amount: 12.5
    })], { session });
  });

  it('debits the rounded promo total and records one redemption across a wallet retry', async () => {
    items['ITM-1'].depositAmount = 10.05;
    borrowList.push({ item: 'ITM-2', ...dates });
    items['ITM-2'] = {
      _id: 'ITM-2', owner: 'lender1', archived: false,
      flagged: false, depositAmount: 20.05,
    };
    db.validatePromoCode.mockResolvedValue({ valid: true, code: 'SAVE10', discountPercent: 10 });

    const result = await checkoutWithWallet('member1', 'promo-key', ' save10 ');
    expect(result).toMatchObject({
      totalDeposit: 27.08, originalTotal: 30.10, promoCode: 'SAVE10', promoDiscountPercent: 10,
    });
    expect(db.validatePromoCode).toHaveBeenCalledWith('SAVE10', 'member1', 10.05, session);
    expect(db.userFindOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ wallet: { $gte: 27.08 } }),
      { $inc: { wallet: -27.08 } },
      { new: true, session },
    );
    expect(db.paymentCreate).toHaveBeenNthCalledWith(
      1, [expect.objectContaining({ amount: 9.04 })], { session },
    );
    expect(db.paymentCreate).toHaveBeenNthCalledWith(
      2, [expect.objectContaining({ amount: 18.04 })], { session },
    );
    expect(db.recordPromoRedemption).toHaveBeenCalledWith({
      checkoutId: result.checkoutId, userId: 'member1', promoCode: 'SAVE10',
      paymentIds: ['PAY-1', 'PAY-2'], reservationIds: ['RES-1', 'RES-2'], session,
      pricing: expect.objectContaining({ originalTotal: 30.10, totalDeposit: 27.08 }),
    });

    db.checkoutFindOne.mockImplementation(() => checkoutQuery({
      ...db.checkoutCreate.mock.calls[0][0][0],
      _id: result.checkoutId,
    }));
    await expect(checkoutWithWallet('member1', 'promo-key', 'SAVE10')).resolves.toEqual({
      ...result, replayed: true,
    });
    expect(db.userFindOneAndUpdate).toHaveBeenCalledOnce();
    expect(db.recordPromoRedemption).toHaveBeenCalledOnce();
  });

  it('aborts without committing when a permanent redemption error follows wallet writes', async () => {
    // Use the real driver transaction handling with the model calls still stubbed.
    const driverSession = new MongoClient('mongodb://127.0.0.1:27017').startSession();
    const abort = vi.spyOn(driverSession, 'abortTransaction');
    const commit = vi.spyOn(driverSession, 'commitTransaction');
    db.startSession.mockResolvedValue(driverSession);
    db.validatePromoCode.mockResolvedValue({ valid: true, discountPercent: 10 });
    db.recordPromoRedemption.mockRejectedValue(new CheckoutError(
      409, 'PROMO_USAGE_LIMIT_REACHED', 'No uses remaining.',
    ));

    await expect(checkoutWithWallet('member1', 'failed-promo', 'SAVE10')).rejects.toMatchObject({
      code: 'PROMO_USAGE_LIMIT_REACHED',
    });
    expect(db.checkoutCreate).toHaveBeenCalledWith(expect.any(Array), { session: driverSession });
    expect(db.recordPromoRedemption).toHaveBeenCalledOnce();
    expect(abort).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();
    expect(driverSession.hasEnded).toBe(true);
  });

  it('reruns the wallet transaction on a labelled redemption write conflict', async () => {
    const driverSession = new MongoClient('mongodb://127.0.0.1:27017').startSession();
    const abort = vi.spyOn(driverSession, 'abortTransaction');
    const commit = vi.spyOn(driverSession, 'commitTransaction');
    const conflict = new MongoServerError({ message: 'Write conflict', code: 112 });
    conflict.addErrorLabel('TransientTransactionError');
    db.startSession.mockResolvedValue(driverSession);
    db.validatePromoCode.mockResolvedValue({ valid: true, discountPercent: 10 });
    db.recordPromoRedemption.mockRejectedValueOnce(conflict);

    await expect(checkoutWithWallet('member1', 'promo-write-conflict', 'SAVE10')).resolves
      .toMatchObject({ totalDeposit: 90, promoCode: 'SAVE10' });
    expect(db.recordPromoRedemption).toHaveBeenCalledTimes(2);
    expect(abort).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledOnce();
  });

  it('returns saved results on retry without starting another transaction', async () => {
    db.checkoutFindOne.mockImplementation(() => checkoutQuery({
      _id: 'CHECKOUT-OLD', user: 'member1', method: 'wallet',
      reservations: ['RES-OLD'], payments: ['PAY-OLD'],
      totalDeposit: 100, remainingBalance: 400,
    }));
    const result = await checkoutWithWallet('member1', 'same-key');
    expect(result).toMatchObject({ checkoutId: 'CHECKOUT-OLD', replayed: true });
    expect(db.startSession).not.toHaveBeenCalled();
    expect(db.userFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects reusing the key for a card checkout', async () => {
    db.checkoutFindOne.mockImplementation(() => checkoutQuery({ method: 'card' }));
    await expect(checkoutWithWallet('member1', 'same-key')).rejects.toMatchObject({
      statusCode: 409, code: 'IDEMPOTENCY_KEY_CONFLICT',
    });
  });

  it('rejects insufficient balance before creating reservations or payments', async () => {
    db.userFindOneAndUpdate.mockResolvedValue(null);
    await expect(checkoutWithWallet('member1', 'key-3')).rejects.toMatchObject({
      statusCode: 409, code: 'WALLET_PAYMENT_FAILED',
    });
    expect(db.reservationCreate).not.toHaveBeenCalled();
    expect(db.paymentCreate).not.toHaveBeenCalled();
    expect(db.checkoutCreate).not.toHaveBeenCalled();
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });

  it('propagates a payment-write failure and closes the session', async () => {
    db.paymentCreate.mockRejectedValue(new Error('Simulated payment failure'));
    await expect(checkoutWithWallet('member1', 'key-4')).rejects.toThrow(
      'Simulated payment failure',
    );
    expect(db.checkoutCreate).not.toHaveBeenCalled();
    expect(session.endSession).toHaveBeenCalledTimes(1);
    // Mocked transactions cannot prove rollback. See the DB integration tests.
  });

  it('keeps cleanup inside the transaction and matches only conflicting dates', async () => {
    await checkoutWithWallet('member1', 'key-5');
    expect(db.userUpdateMany).toHaveBeenCalledWith(
      { _id: { $ne: 'member1' } },
      {
        $pull: {
          borrow_list: {
            item: 'ITM-1',
            startDate: { $lt: dates.endDate },
            endDate: { $gt: dates.startDate },
          },
        },
      },
      { session },
    );
  });

  it('returns a prior committed checkout after a duplicate-key race', async () => {
    const completed = {
      _id: 'CHECKOUT-WINNER', method: 'wallet',
      reservations: ['RES-WINNER'], payments: ['PAY-WINNER'],
      totalDeposit: 100, remainingBalance: 400,
    };
    db.checkoutFindOne
      .mockReturnValueOnce(checkoutQuery(null)) // initial lookup
      .mockReturnValueOnce(checkoutQuery(null)) // lookup inside transaction
      .mockReturnValueOnce(checkoutQuery(completed)); // lookup after code 11000
    db.checkoutCreate.mockRejectedValue(Object.assign(new Error('duplicate'), {
      code: 11000,
    }));

    const result = await checkoutWithWallet('member1', 'duplicate-key');
    expect(result).toMatchObject({ checkoutId: 'CHECKOUT-WINNER', replayed: true });
    expect(session.endSession).toHaveBeenCalledTimes(1);
    // This exercises only error handling; the DB unique-index test proves enforcement.
  });
});
vi.mock('../services/waitlistAvailability.js', () => ({
    checkWaitlistAvailability: vi.fn(),
    releaseWaitlistEntry: vi.fn()
}));
