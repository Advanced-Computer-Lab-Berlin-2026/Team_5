import { beforeEach, describe, expect, it, vi } from 'vitest';

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
}));

vi.mock('mongoose', () => ({
  default: { startSession: db.startSession },
}));
vi.mock('../models/User.js', () => ({
  User: {
    findById: db.userFindById,
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
        ? { borrow_list: borrowList }
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
        _id: 'member1', role: 'member', suspended: { $ne: true },
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
