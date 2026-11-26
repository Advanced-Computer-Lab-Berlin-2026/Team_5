
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Notification } from '../models/Notification.js';

const mocks = vi.hoisted(() => ({
    itemFindById: vi.fn(),
    userFindOneAndUpdate: vi.fn(),
    paymentCreate: vi.fn(),
    reservationUpdateOne: vi.fn()
}));

vi.mock('../models/Item.js', () => ({
    Item: { findById: mocks.itemFindById }
}));

vi.mock('../models/User.js', () => ({
    User: { findOneAndUpdate: mocks.userFindOneAndUpdate }
}));

vi.mock('../models/Payment.js', () => ({
    Payment: { create: mocks.paymentCreate }
}));

vi.mock('../models/Reservation.js', () => ({
    Reservation: { updateOne: mocks.reservationUpdateOne }
}));

import {
    calculateLateFee,
    chargeLateFeeForReturn
} from '../services/lateFeeService.js';

const due = '2026-11-20T12:00:00.000Z';

function makeReservation(returnedAt) {
    return {
        _id: 'RES-test1234',
        item: 'item-1',
        borrower: 'member-1',
        endDate: new Date(due),
        handover: {
            returnedAt: new Date(returnedAt)
        }
    };
}

beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    vi.spyOn(Notification, 'create').mockResolvedValue([]);

    mocks.itemFindById.mockReturnValue({
        session: vi.fn().mockResolvedValue({
            borrowingRules: { lateFeePerDay: 10 }
        })
    });

    mocks.userFindOneAndUpdate.mockResolvedValue({
        _id: 'member-1',
        wallet: 80
    });

    mocks.paymentCreate.mockResolvedValue([
        { _id: 'payment-1' }
    ]);

    mocks.reservationUpdateOne.mockResolvedValue({
        matchedCount: 1
    });
});

describe('SCRUM-467 - Late fee calculation', () => {
    it('charges nothing when returned on time', () => {
        const result = calculateLateFee({
            endDate: due,
            returnedAt: due,
            lateFeePerDay: 10
        });

        expect(result).toEqual({
            daysLate: 0,
            lateFee: 0
        });
    });

    it('charges nothing for an early return', () => {
        const result = calculateLateFee({
            endDate: due,
            returnedAt: '2026-11-19T12:00:00.000Z',
            lateFeePerDay: 10
        });

        expect(result.lateFee).toBe(0);
    });

    it('rounds a partial overdue day up', () => {
        const result = calculateLateFee({
            endDate: due,
            returnedAt: '2026-11-20T13:00:00.000Z',
            lateFeePerDay: 10
        });

        expect(result).toEqual({
            daysLate: 1,
            lateFee: 10
        });
    });

    it('counts 1.5 days as 2 days', () => {
        const result = calculateLateFee({
            endDate: due,
            returnedAt: '2026-11-22T00:00:00.000Z',
            lateFeePerDay: 10
        });

        expect(result).toEqual({
            daysLate: 2,
            lateFee: 20
        });
    });

    it('counts exactly 3 days as 3 days', () => {
        const result = calculateLateFee({
            endDate: due,
            returnedAt: '2026-11-23T12:00:00.000Z',
            lateFeePerDay: 10
        });

        expect(result).toEqual({
            daysLate: 3,
            lateFee: 30
        });
    });

    it('respects a zero daily fee', () => {
        const result = calculateLateFee({
            endDate: due,
            returnedAt: '2026-11-25T12:00:00.000Z',
            lateFeePerDay: 0
        });

        expect(result.lateFee).toBe(0);
    });
});

describe('SCRUM-468 - Wallet deduction', () => {
    const session = { id: 'test-session' };

    it('deducts the fee and logs a payment', async () => {
        const reservation = makeReservation(
            '2026-11-22T00:00:00.000Z'
        );

        const result = await chargeLateFeeForReturn(
            reservation,
            session
        );

        expect(result).toEqual({
            daysLate: 2,
            lateFee: 20
        });

        expect(mocks.userFindOneAndUpdate).toHaveBeenCalledWith(
            { _id: 'member-1' },
            {
                $inc: { wallet: -20 }
            },
            {
                session,
                new: true
            }
        );

        expect(mocks.paymentCreate).toHaveBeenCalledWith(
            [expect.objectContaining({
                user: 'member-1',
                reservation: 'RES-test1234',
                type: 'late-fee',
                amount: 20,
                direction: 'deduct',
                method: 'wallet',
                status: 'completed'
            })],
            { session }
        );

        expect(Notification.create).toHaveBeenCalledExactlyOnceWith([{
            username: 'member-1',
            type: 'other',
            reservation: 'RES-test1234',
            message: 'A late fee of €20.00 was charged for reservation RES-test1234.'
        }], { session });
        expect(mocks.paymentCreate).toHaveBeenCalledBefore(Notification.create);

        expect(mocks.reservationUpdateOne).toHaveBeenCalledWith(
            {
                _id: 'RES-test1234',
                status: 'completed'
            },
            {
                $set: {
                    'payment.lateFee': 20
                }
            },
            { session }
        );
    });

    it('does not deduct or log anything when on time', async () => {
        const reservation = makeReservation(due);

        const result = await chargeLateFeeForReturn(
            reservation,
            session
        );

        expect(result.lateFee).toBe(0);
        expect(mocks.userFindOneAndUpdate).not.toHaveBeenCalled();
        expect(mocks.paymentCreate).not.toHaveBeenCalled();
        expect(Notification.create).not.toHaveBeenCalled();
    });

    it('does not notify for an overdue return with a zero fee', async () => {
        mocks.itemFindById.mockReturnValue({
            session: vi.fn().mockResolvedValue({ borrowingRules: { lateFeePerDay: 0 } })
        });

        const result = await chargeLateFeeForReturn(makeReservation('2026-11-22T00:00:00.000Z'), session);

        expect(result).toEqual({ daysLate: 2, lateFee: 0 });
        expect(Notification.create).not.toHaveBeenCalled();
    });

    it('does not notify if recording the charge fails', async () => {
        mocks.paymentCreate.mockRejectedValue(new Error('Payment write failed'));

        await expect(chargeLateFeeForReturn(makeReservation('2026-11-22T00:00:00.000Z'), session))
            .rejects.toThrow('Payment write failed');

        expect(Notification.create).not.toHaveBeenCalled();
    });

    it('charges the fee even when the wallet is empty, so the wallet goes negative', async () => {
        mocks.userFindOneAndUpdate.mockResolvedValue({ _id: 'member-1', wallet: -20 });

        const result = await chargeLateFeeForReturn(
            makeReservation('2026-11-22T00:00:00.000Z'),
            session
        );

        expect(result.lateFee).toBe(20);
        // no { wallet: { $gte } } filter, so the return is never blocked by the balance
        expect(mocks.userFindOneAndUpdate).toHaveBeenCalledWith(
            { _id: 'member-1' },
            { $inc: { wallet: -20 } },
            { session, new: true }
        );
        expect(mocks.paymentCreate).toHaveBeenCalledWith(
            [expect.objectContaining({ type: 'late-fee', amount: 20, direction: 'deduct' })],
            { session }
        );
        expect(mocks.reservationUpdateOne).toHaveBeenCalled();
    });

    it('404 and no payment when the borrower account was deleted', async () => {
        mocks.userFindOneAndUpdate.mockResolvedValue(null);

        await expect(
            chargeLateFeeForReturn(
                makeReservation('2026-11-22T00:00:00.000Z'),
                session
            )
        ).rejects.toMatchObject({
            statusCode: 404,
            code: 'BORROWER_NOT_FOUND',
            message: 'User member-1 not found'
        });

        expect(mocks.paymentCreate).not.toHaveBeenCalled();
        expect(mocks.reservationUpdateOne).not.toHaveBeenCalled();
        expect(Notification.create).not.toHaveBeenCalled();
    });
});
