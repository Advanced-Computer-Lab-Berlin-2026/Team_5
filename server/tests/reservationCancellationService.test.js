
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    startSession: vi.fn(),
    reservationFindById: vi.fn(),
    reservationFindOneAndUpdate: vi.fn(),
    reservationUpdateOne: vi.fn(),
    paymentFind: vi.fn(),
    paymentFindOne: vi.fn(),
    paymentCreate: vi.fn(),
    itemFindById: vi.fn(),
    userFindOneAndUpdate: vi.fn()
}));

vi.mock('mongoose', () => ({
    default: {
        startSession: mocks.startSession
    }
}));

vi.mock('../models/Reservation.js', () => ({
    Reservation: {
        findById: mocks.reservationFindById,
        findOneAndUpdate: mocks.reservationFindOneAndUpdate,
        updateOne: mocks.reservationUpdateOne
    }
}));

vi.mock('../models/Payment.js', () => ({
    Payment: {
        find: mocks.paymentFind,
        findOne: mocks.paymentFindOne,
        create: mocks.paymentCreate
    }
}));

vi.mock('../models/Item.js', () => ({
    Item: {
        findById: mocks.itemFindById
    }
}));

vi.mock('../models/User.js', () => ({
    User: {
        findOneAndUpdate: mocks.userFindOneAndUpdate
    }
}));

vi.mock('../models/Notification.js', () => ({
    Notification: { create: vi.fn() }
}));

import { cancelReservationWithRefund } from '../services/reservationCancellationService.js';

const START = new Date('2026-11-25T12:00:00.000Z');
const END = new Date('2026-11-26T12:00:00.000Z');

function query(result) {
    return {
        session: vi.fn().mockResolvedValue(result)
    };
}

function makeReservation(overrides = {}) {
    return {
        _id: 'RES-123',
        borrower: 'member-1',
        lender: 'lender-1',
        item: 'item-1',
        status: 'upcoming',
        startDate: START,
        endDate: END,
        handover: { pickedUpAt: null },
        payment: {
            method: 'wallet',
            depositAmount: 100
        },
        cancellationPolicy: {
            freeDays: 3,
            forfeitPercent: 25
        },
        ...overrides
    };
}

let dbSession;

beforeEach(() => {
    vi.resetAllMocks();

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-17T12:00:00.000Z'));

    dbSession = {
        withTransaction: vi.fn(async (callback) => callback()),
        endSession: vi.fn().mockResolvedValue(undefined)
    };

    mocks.startSession.mockResolvedValue(dbSession);

    mocks.reservationFindById.mockReturnValue(
        query(makeReservation())
    );

    mocks.paymentFind.mockReturnValue(
        query([{ _id: 'PAY-ORIGINAL', amount: 100 }])
    );

    mocks.reservationFindOneAndUpdate.mockResolvedValue(
        makeReservation({ status: 'cancelled' })
    );

    mocks.userFindOneAndUpdate.mockResolvedValue({
        _id: 'member-1',
        wallet: 200
    });

    mocks.paymentCreate.mockResolvedValue([
        { _id: 'PAY-REFUND', amount: 100 }
    ]);

    mocks.reservationUpdateOne.mockResolvedValue({
        matchedCount: 1
    });

    mocks.itemFindById.mockReturnValue(
        query({
            cancellation: {
                freeDays: 3,
                forfeitPercent: 25
            }
        })
    );
});

afterEach(() => {
    vi.useRealTimers();
});

describe('cancelReservationWithRefund', () => {
    it('rejects an invalid reservation ID', async () => {
        await expect(
            cancelReservationWithRefund('invalid', 'member-1')
        ).rejects.toThrow('Invalid reservation ID.');

        expect(mocks.startSession).not.toHaveBeenCalled();
    });

    it('returns 404 when the reservation does not exist', async () => {
        mocks.reservationFindById.mockReturnValue(query(null));

        await expect(
            cancelReservationWithRefund('RES-123', 'member-1')
        ).rejects.toThrow('Reservation not found.');

        expect(mocks.userFindOneAndUpdate).not.toHaveBeenCalled();
        expect(dbSession.endSession).toHaveBeenCalledOnce();
    });

    it('rejects a user who is neither borrower nor lender', async () => {
        await expect(
            cancelReservationWithRefund('RES-123', 'stranger')
        ).rejects.toThrow(
            'Only the borrower or lender may cancel.'
        );

        expect(mocks.paymentFind).not.toHaveBeenCalled();
        expect(mocks.userFindOneAndUpdate).not.toHaveBeenCalled();
    });

    it('refunds the full deposit when the lender cancels', async () => {
        const result = await cancelReservationWithRefund(
            'RES-123',
            'lender-1'
        );

        expect(result).toEqual({
            reservationId: 'RES-123',
            status: 'cancelled',
            refundAmount: 100,
            refundPaymentId: 'PAY-REFUND',
            replayed: false
        });

        expect(mocks.userFindOneAndUpdate).toHaveBeenCalledWith(
            { _id: 'member-1' },
            { $inc: { wallet: 100 } },
            { session: dbSession, new: true }
        );

        expect(mocks.paymentCreate).toHaveBeenCalledWith(
            [expect.objectContaining({
                user: 'member-1',
                reservation: 'RES-123',
                sourcePaymentId: 'PAY-ORIGINAL',
                refundKey: 'cancellation:RES-123',
                type: 'deposit-refund',
                amount: 100,
                direction: 'receive',
                method: 'wallet',
                status: 'completed'
            })],
            { session: dbSession }
        );

        expect(mocks.reservationUpdateOne).toHaveBeenCalledWith(
            {
                _id: 'RES-123',
                status: 'cancelled'
            },
            {
                $set: {
                    cancellationRefundPaymentId: 'PAY-REFUND'
                }
            },
            { session: dbSession }
        );

        expect(dbSession.endSession).toHaveBeenCalledOnce();
    });

    it('gives a full member refund inside the free window', async () => {
        const result = await cancelReservationWithRefund(
            'RES-123',
            'member-1'
        );

        expect(result.refundAmount).toBe(100);

        expect(mocks.userFindOneAndUpdate).toHaveBeenCalledWith(
            { _id: 'member-1' },
            { $inc: { wallet: 100 } },
            { session: dbSession, new: true }
        );
    });

    it('gives a partial refund after the free window', async () => {
        const reservation = makeReservation({
            startDate: new Date('2026-11-18T12:00:00.000Z')
        });

        mocks.reservationFindById.mockReturnValue(
            query(reservation)
        );

        const result = await cancelReservationWithRefund(
            'RES-123',
            'member-1'
        );

        // 100 deposit with 25% forfeiture = 75 refund.
        expect(result.refundAmount).toBe(75);

        expect(mocks.userFindOneAndUpdate).toHaveBeenCalledWith(
            { _id: 'member-1' },
            { $inc: { wallet: 75 } },
            { session: dbSession, new: true }
        );

        expect(mocks.itemFindById).not.toHaveBeenCalled();
    });

    it('refunds only the reservation allocation from a card checkout', async () => {
        const reservation = makeReservation({
            payment: {
                method: 'card',
                depositAmount: 80,
                stripePaymentIntentId: 'pi_test_123'
            }
        });

        mocks.reservationFindById.mockReturnValue(
            query(reservation)
        );

        mocks.paymentFind.mockReturnValue(query([{
            _id: 'PAY-CARD',
            amount: 200,
            stripeAmountCents: 20000,
            checkoutItems: [
                {
                    itemId: 'item-1',
                    lenderId: 'lender-1',
                    startDate: START,
                    endDate: END,
                    depositAmount: 80
                },
                {
                    itemId: 'item-2',
                    lenderId: 'lender-2',
                    startDate: START,
                    endDate: END,
                    depositAmount: 120
                }
            ]
        }]));

        const result = await cancelReservationWithRefund(
            'RES-123',
            'lender-1'
        );

        expect(result.refundAmount).toBe(80);

        expect(mocks.userFindOneAndUpdate).toHaveBeenCalledWith(
            { _id: 'member-1' },
            { $inc: { wallet: 80 } },
            { session: dbSession, new: true }
        );

        expect(mocks.paymentCreate).toHaveBeenCalledWith(
            [expect.objectContaining({
                sourcePaymentId: 'PAY-CARD',
                amount: 80,
                method: 'wallet'
            })],
            { session: dbSession }
        );
    });

    it('does not refund an active reservation', async () => {
        mocks.reservationFindById.mockReturnValue(
            query(makeReservation({ status: 'active' }))
        );

        await expect(
            cancelReservationWithRefund('RES-123', 'member-1')
        ).rejects.toThrow('This reservation cannot be cancelled.');

        expect(mocks.userFindOneAndUpdate).not.toHaveBeenCalled();
        expect(mocks.paymentCreate).not.toHaveBeenCalled();
    });

    it('does not refund after the item has been picked up', async () => {
        mocks.reservationFindById.mockReturnValue(
            query(makeReservation({
                handover: {
                    pickedUpAt: new Date('2026-11-16T12:00:00.000Z')
                }
            }))
        );

        await expect(
            cancelReservationWithRefund('RES-123', 'member-1')
        ).rejects.toThrow('This reservation cannot be cancelled.');

        expect(mocks.userFindOneAndUpdate).not.toHaveBeenCalled();
    });

    it('rejects a mismatch with the original wallet payment', async () => {
        mocks.paymentFind.mockReturnValue(
            query([{ _id: 'PAY-ORIGINAL', amount: 99 }])
        );

        await expect(
            cancelReservationWithRefund('RES-123', 'member-1')
        ).rejects.toThrow('Wallet payment amount mismatch.');

        expect(mocks.userFindOneAndUpdate).not.toHaveBeenCalled();
        expect(mocks.paymentCreate).not.toHaveBeenCalled();
    });

    it('requires an original payment for a reservation without an unpaid marker', async () => {
        mocks.paymentFind.mockReturnValue(query([]));

        await expect(cancelReservationWithRefund('RES-123', 'member-1')).rejects.toMatchObject({
            statusCode: 409,
            code: 'PAYMENT_NOT_VERIFIED'
        });

        expect(mocks.reservationFindOneAndUpdate).not.toHaveBeenCalled();
        expect(mocks.userFindOneAndUpdate).not.toHaveBeenCalled();
        expect(mocks.paymentCreate).not.toHaveBeenCalled();
    });

    it('replays an existing cancellation without crediting again', async () => {
        mocks.reservationFindById.mockReturnValue(
            query(makeReservation({
                status: 'cancelled',
                cancellationRefundAmount: 75,
                cancellationRefundPaymentId: 'PAY-REFUND'
            }))
        );

        mocks.paymentFindOne.mockReturnValue(
            query({
                _id: 'PAY-REFUND',
                amount: 75
            })
        );

        const result = await cancelReservationWithRefund(
            'RES-123',
            'member-1'
        );

        expect(result).toEqual({
            reservationId: 'RES-123',
            status: 'cancelled',
            refundAmount: 75,
            refundPaymentId: 'PAY-REFUND',
            replayed: true
        });

        expect(mocks.userFindOneAndUpdate).not.toHaveBeenCalled();
        expect(mocks.paymentCreate).not.toHaveBeenCalled();
    });

    it('does not credit the wallet if the reservation update loses a race', async () => {
        mocks.reservationFindOneAndUpdate.mockResolvedValue(null);

        await expect(
            cancelReservationWithRefund('RES-123', 'member-1')
        ).rejects.toThrow(
            'Reservation changed during cancellation; retry.'
        );

        expect(mocks.userFindOneAndUpdate).not.toHaveBeenCalled();
        expect(mocks.paymentCreate).not.toHaveBeenCalled();
    });

    it('does not create a refund record if the borrower is missing', async () => {
        mocks.userFindOneAndUpdate.mockResolvedValue(null);

        await expect(
            cancelReservationWithRefund('RES-123', 'member-1')
        ).rejects.toThrow(
            'Borrower not found during wallet refund.'
        );

        expect(mocks.paymentCreate).not.toHaveBeenCalled();
        expect(dbSession.endSession).toHaveBeenCalledOnce();
    });
});
