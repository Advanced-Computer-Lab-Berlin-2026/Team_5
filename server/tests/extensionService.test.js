
import { beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { Notification } from '../models/Notification.js';

const mocks = vi.hoisted(() => ({
    reservationFindById: vi.fn(),
    reservationFindOverlap: vi.fn(),
    reservationFindOneAndUpdate: vi.fn(),
    reservationFind: vi.fn(),
    extensionFindOne: vi.fn(),
    extensionFind: vi.fn(),
    extensionCreate: vi.fn(),
    extensionFindOneAndUpdate: vi.fn(),
    acquireCheckoutLock: vi.fn()
}));

vi.mock('../models/Reservation.js', () => ({
    Reservation: {
        findById: mocks.reservationFindById,
        findOverlap: mocks.reservationFindOverlap,
        findOneAndUpdate: mocks.reservationFindOneAndUpdate,
        find: mocks.reservationFind
    }
}));

vi.mock('../models/ExtensionRequest.js', () => ({
    ExtensionRequest: {
        findOne: mocks.extensionFindOne,
        find: mocks.extensionFind,
        create: mocks.extensionCreate,
        findOneAndUpdate: mocks.extensionFindOneAndUpdate
    }
}));

vi.mock('../services/checkoutService.js', () => ({
    acquireCheckoutLock: mocks.acquireCheckoutLock
}));

import {
    requestExtension,
    decideExtension,
    getPendingExtensions
} from '../services/extensionService.js';

const RES_ID = 'RES-a1b2c3d4';
const REQUEST_ID = '507f191e810c19729de860ea';

const originalEndDate = new Date('2026-12-04T12:00:00.000Z');
const requestedEndDate = new Date('2026-12-05T23:30:00.000Z');

function query(value) {
    return {
        session: vi.fn().mockResolvedValue(value),
        then(resolve, reject) {
            return Promise.resolve(value).then(resolve, reject);
        }
    };
}

function reservation() {
    return {
        _id: RES_ID,
        borrower: 'member-1',
        lender: 'lender-1',
        item: 'item-1',
        status: 'active',
        startDate: new Date('2026-12-01T12:00:00.000Z'),
        endDate: originalEndDate
    };
}

function extensionRequest() {
    return {
        _id: REQUEST_ID,
        reservation: RES_ID,
        originalEndDate,
        requestedEndDate,
        status: 'requested'
    };
}

let session;

beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();

    session = {
        withTransaction: vi.fn(async callback => callback()),
        endSession: vi.fn().mockResolvedValue(undefined)
    };

    vi.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    vi.spyOn(Notification, 'create').mockResolvedValue([]);

    mocks.reservationFindById.mockImplementation(
        () => query(reservation())
    );

    mocks.extensionFindOne.mockImplementation(
        () => query(null)
    );

    mocks.reservationFindOverlap.mockResolvedValue(null);

    mocks.extensionCreate.mockResolvedValue([extensionRequest()]);

    mocks.acquireCheckoutLock.mockResolvedValue({ _id: 'item-1' });

    mocks.reservationFindOneAndUpdate.mockResolvedValue({
        ...reservation(),
        endDate: requestedEndDate
    });

    mocks.extensionFindOneAndUpdate.mockResolvedValue({
        ...extensionRequest(),
        status: 'accepted'
    });
});

describe('SCRUM-472 - Request extension', () => {

    it('allows a member to request available dates', async () => {
        const result = await requestExtension(
            RES_ID,
            'member-1',
            requestedEndDate.toISOString()
        );

        expect(result.status).toBe('requested');

        expect(mocks.reservationFindOverlap).toHaveBeenCalledWith(
            'item-1',
            originalEndDate,
            requestedEndDate,
            null,
            RES_ID
        );

        expect(mocks.extensionCreate).toHaveBeenCalledWith([{
            reservation: RES_ID,
            originalEndDate,
            requestedEndDate,
            status: 'requested'
        }], { session });
        expect(Notification.create).toHaveBeenCalledExactlyOnceWith([{
            username: 'lender-1',
            type: 'other',
            reservation: RES_ID,
            message: `A member requested an extension for reservation ${RES_ID} until 6 Dec 2026.`
        }], { session });
        expect(mocks.extensionCreate).toHaveBeenCalledBefore(Notification.create);

        // Requesting does not change the return date.
        expect(
            mocks.reservationFindOneAndUpdate
        ).not.toHaveBeenCalled();
    });

    it('rejects a request from someone other than the borrower', async () => {
        await expect(
            requestExtension(
                RES_ID,
                'another-member',
                requestedEndDate.toISOString()
            )
        ).rejects.toThrow(
            'Only the borrower can request an extension.'
        );

        expect(mocks.extensionCreate).not.toHaveBeenCalled();
        expect(Notification.create).not.toHaveBeenCalled();
    });

    it('rejects an extension when the dates are unavailable', async () => {
        mocks.reservationFindOverlap.mockResolvedValue({
            _id: 'RES-other'
        });

        await expect(
            requestExtension(
                RES_ID,
                'member-1',
                requestedEndDate.toISOString()
            )
        ).rejects.toThrow(
            'The item is already reserved during the requested extension.'
        );

        expect(mocks.extensionCreate).not.toHaveBeenCalled();
        expect(Notification.create).not.toHaveBeenCalled();
    });

    it('rejects duplicate pending extension requests', async () => {
        mocks.extensionFindOne.mockImplementation(
            () => query(extensionRequest())
        );

        await expect(
            requestExtension(
                RES_ID,
                'member-1',
                requestedEndDate.toISOString()
            )
        ).rejects.toThrow(
            'An extension request is already pending.'
        );

        expect(mocks.extensionCreate).not.toHaveBeenCalled();
        expect(Notification.create).not.toHaveBeenCalled();
    });

    it('does not notify if a concurrent request wins the unique index', async () => {
        mocks.extensionCreate.mockRejectedValue(Object.assign(new Error('Duplicate key'), { code: 11000 }));

        await expect(requestExtension(RES_ID, 'member-1', requestedEndDate.toISOString()))
            .rejects.toMatchObject({ code: 'EXTENSION_ALREADY_REQUESTED' });

        expect(Notification.create).not.toHaveBeenCalled();
        expect(session.endSession).toHaveBeenCalledOnce();
    });

    it('fails the write transaction if the lender notification cannot be saved', async () => {
        const error = new Error('Notification write failed');
        Notification.create.mockRejectedValue(error);

        await expect(requestExtension(RES_ID, 'member-1', requestedEndDate.toISOString()))
            .rejects.toBe(error);

        expect(mocks.extensionCreate).toHaveBeenCalledWith(expect.any(Array), { session });
        expect(Notification.create).toHaveBeenCalledWith(expect.any(Array), { session });
        expect(session.endSession).toHaveBeenCalledOnce();
    });

    it('requires an active reservation', async () => {
        mocks.reservationFindById.mockImplementation(
            () => query({
                ...reservation(),
                status: 'completed'
            })
        );

        await expect(
            requestExtension(
                RES_ID,
                'member-1',
                requestedEndDate.toISOString()
            )
        ).rejects.toThrow(
            'Only active reservations can be extended.'
        );
    });
});

describe('SCRUM-474 - Decide extension', () => {

    beforeEach(() => {
        mocks.extensionFindOne.mockImplementation(
            () => query(extensionRequest())
        );
    });

    it('allows the lender to accept and update the return date', async () => {
        const result = await decideExtension(
            RES_ID,
            REQUEST_ID,
            'lender-1',
            'accept'
        );

        expect(result.status).toBe('accepted');
        expect(result.endDate).toEqual(requestedEndDate);

        expect(mocks.acquireCheckoutLock).toHaveBeenCalledWith(
            'item-1',
            session
        );

        expect(mocks.reservationFindOverlap).toHaveBeenCalledWith(
            'item-1',
            originalEndDate,
            requestedEndDate,
            session,
            RES_ID
        );

        expect(mocks.reservationFindOneAndUpdate).toHaveBeenCalledWith(
            {
                _id: RES_ID,
                status: 'active',
                endDate: originalEndDate
            },
            {
                $set: {
                    endDate: requestedEndDate
                }
            },
            { new: true, session }
        );

        expect(Notification.create).toHaveBeenCalledExactlyOnceWith([{
            username: 'member-1',
            type: 'other',
            reservation: RES_ID,
            message: `Your extension request for reservation ${RES_ID} was accepted. Your new return date is 6 Dec 2026.`
        }], { session });
        expect(mocks.reservationFindOneAndUpdate).toHaveBeenCalledBefore(Notification.create);
        expect(mocks.extensionFindOneAndUpdate).toHaveBeenCalledBefore(Notification.create);
        expect(session.endSession).toHaveBeenCalledOnce();
    });

    it('allows the lender to reject without changing the date', async () => {
        mocks.extensionFindOneAndUpdate.mockResolvedValue({
            ...extensionRequest(),
            status: 'rejected'
        });

        const result = await decideExtension(
            RES_ID,
            REQUEST_ID,
            'lender-1',
            'reject'
        );

        expect(result.status).toBe('rejected');
        expect(result.endDate).toEqual(originalEndDate);

        expect(Notification.create).toHaveBeenCalledExactlyOnceWith([{
            username: 'member-1',
            type: 'other',
            reservation: RES_ID,
            message: `Your extension request for reservation ${RES_ID} was rejected.`
        }], { session });
        expect(mocks.extensionFindOneAndUpdate).toHaveBeenCalledBefore(Notification.create);

        expect(
            mocks.reservationFindOneAndUpdate
        ).not.toHaveBeenCalled();

        expect(
            mocks.acquireCheckoutLock
        ).not.toHaveBeenCalled();
    });

    it('prevents a different lender from deciding', async () => {
        await expect(
            decideExtension(
                RES_ID,
                REQUEST_ID,
                'another-lender',
                'accept'
            )
        ).rejects.toThrow(
            'Only the reservation lender can decide.'
        );

        expect(
            mocks.reservationFindOneAndUpdate
        ).not.toHaveBeenCalled();
        expect(Notification.create).not.toHaveBeenCalled();
    });

    it('rechecks availability when the lender approves', async () => {
        mocks.reservationFindOverlap.mockResolvedValue({
            _id: 'RES-other'
        });

        await expect(
            decideExtension(
                RES_ID,
                REQUEST_ID,
                'lender-1',
                'accept'
            )
        ).rejects.toThrow(
            'Another reservation conflicts with the extension.'
        );

        expect(
            mocks.reservationFindOneAndUpdate
        ).not.toHaveBeenCalled();

        expect(
            mocks.extensionFindOneAndUpdate
        ).not.toHaveBeenCalled();
        expect(Notification.create).not.toHaveBeenCalled();
    });

    it.each(['accept', 'reject'])('does not notify when a repeated %s finds a decided request', async (decision) => {
        mocks.extensionFindOne.mockReturnValueOnce(query(extensionRequest()))
            .mockReturnValueOnce(query({ ...extensionRequest(), status: 'accepted' }));

        await decideExtension(RES_ID, REQUEST_ID, 'lender-1', 'accept');
        await expect(decideExtension(RES_ID, REQUEST_ID, 'lender-1', decision))
            .rejects.toMatchObject({ code: 'EXTENSION_ALREADY_DECIDED' });

        expect(Notification.create).toHaveBeenCalledOnce();
    });

    it.each(['accept', 'reject'])('does not notify if the extension update for %s fails', async (decision) => {
        mocks.extensionFindOneAndUpdate.mockResolvedValue(null);

        await expect(decideExtension(RES_ID, REQUEST_ID, 'lender-1', decision))
            .rejects.toMatchObject({ code: 'EXTENSION_CONFLICT' });

        expect(Notification.create).not.toHaveBeenCalled();
    });

    it('does not notify if acceptance cannot update the end date', async () => {
        mocks.reservationFindOneAndUpdate.mockResolvedValue(null);

        await expect(decideExtension(RES_ID, REQUEST_ID, 'lender-1', 'accept'))
            .rejects.toMatchObject({ code: 'EXTENSION_CONFLICT' });

        expect(Notification.create).not.toHaveBeenCalled();
    });

    it.each([false, true])('discards the first notification on abort (transaction retry: %s)', async (retry) => {
        const error = new Error('Transaction aborted');
        const staged = [];
        const committed = [];
        Notification.create.mockImplementation(async (documents, options) => {
            expect(options).toEqual({ session });
            staged.push(...documents);
            return documents;
        });
        session.withTransaction.mockImplementation(async (callback) => {
            await callback();
            staged.length = 0;
            if (!retry) throw error;
            const result = await callback();
            committed.push(...staged);
            return result;
        });

        const decision = decideExtension(RES_ID, REQUEST_ID, 'lender-1', 'accept');
        if (retry) {
            await expect(decision).resolves.toMatchObject({ status: 'accepted' });
        } else {
            await expect(decision).rejects.toBe(error);
        }

        expect(Notification.create).toHaveBeenCalledTimes(retry ? 2 : 1);
        expect(committed).toHaveLength(retry ? 1 : 0);
        expect(session.endSession).toHaveBeenCalledOnce();
    });
});

describe('Pending extension requests', () => {
    it('lists extension requests for the lender', async () => {
        mocks.reservationFind.mockReturnValue({
            select: () => ({
                lean: async () => [reservation()]
            })
        });

        mocks.extensionFind.mockReturnValue({
            sort: () => ({
                lean: async () => [extensionRequest()]
            })
        });

        const result = await getPendingExtensions('lender-1');

        expect(result).toHaveLength(1);

        expect(result[0]).toEqual(
            expect.objectContaining({
                requestId: REQUEST_ID,
                reservationId: RES_ID,
                status: 'requested',
                borrower: 'member-1',
                item: 'item-1'
            })
        );

        expect(mocks.reservationFind).toHaveBeenCalledWith({
            lender: 'lender-1',
            status: 'active'
        });
    });
});
