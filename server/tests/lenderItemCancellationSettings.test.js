
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    findCategory: vi.fn(),
    createItem: vi.fn(),
    findItem: vi.fn()
}));

vi.mock('../models/Category.js', () => ({
    Category: { findById: mocks.findCategory }
}));

vi.mock('../models/Item.js', () => ({
    Item: {
        create: mocks.createItem,
        findById: mocks.findItem
    }
}));

vi.mock('../services/itemPhotoStorage.js', () => ({
    uploadItemPhoto: vi.fn(),
    deleteItemPhoto: vi.fn()
}));

vi.mock('../services/itemManualStorage.js', () => ({
    uploadItemManual: vi.fn(),
    deleteItemManual: vi.fn()
}));

vi.mock('../middleware/uploadItemPhotos.js', () => ({
    MAX_PHOTOS: 5
}));

import {
    createItem,
    updateItem
} from '../controllers/lenderItemController.js';

const validItemBody = {
    name: 'Camera',
    description: 'A camera to borrow',
    category: 'cat-1',
    depositAmount: 100,
    pickupLocation: 'Berlin'
};

function response() {
    const res = {
        status: vi.fn(),
        json: vi.fn()
    };

    res.status.mockReturnValue(res);
    res.json.mockReturnValue(res);

    return res;
}

function existingItem() {
    return {
        _id: 'item-1',
        owner: 'lender-1',
        name: 'Camera',
        pickup: {
            location: 'Berlin',
            instructions: ''
        },
        borrowingRules: {
            maxDurationDays: 7,
            minTrustScore: 0
        },
        cancellation: {
            freeDays: 3,
            forfeitPercent: 20
        },
        save: vi.fn().mockResolvedValue(undefined)
    };
}

beforeEach(() => {
    vi.resetAllMocks();

    mocks.findCategory.mockResolvedValue({
        _id: 'cat-1'
    });

    mocks.createItem.mockImplementation(
        async (data) => ({
            _id: 'item-1',
            ...data
        })
    );
});

describe('lender item cancellation settings', () => {

    it('accepts and saves cancellation settings when an item is created', async () => {
        const req = {
            user: { id: 'lender-1' },
            body: {
                ...validItemBody,
                cancellation: {
                    freeDays: 3,
                    forfeitPercent: 20
                }
            }
        };

        const res = response();
        const next = vi.fn();

        await createItem(req, res, next);

        expect(next).not.toHaveBeenCalled();

        expect(mocks.createItem).toHaveBeenCalledWith(
            expect.objectContaining({
                owner: 'lender-1',
                cancellation: {
                    freeDays: 3,
                    forfeitPercent: 20
                }
            })
        );

        expect(res.status).toHaveBeenCalledWith(201);
    });

    it('still accepts item creation without optional cancellation settings', async () => {
        const req = {
            user: { id: 'lender-1' },
            body: { ...validItemBody }
        };

        const res = response();
        const next = vi.fn();

        await createItem(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(mocks.createItem).toHaveBeenCalledOnce();

        expect(
            mocks.createItem.mock.calls[0][0]
        ).not.toHaveProperty('cancellation');

        expect(res.status).toHaveBeenCalledWith(201);
    });

    it.each([
        [
            'negative freeDays',
            { freeDays: -1, forfeitPercent: 20 }
        ],
        [
            'forfeitPercent above 100',
            { freeDays: 3, forfeitPercent: 101 }
        ],
        [
            'empty policy object',
            {}
        ]
    ])('rejects %s when creating an item', async (_label, cancellation) => {
        const req = {
            user: { id: 'lender-1' },
            body: {
                ...validItemBody,
                cancellation
            }
        };

        const res = response();
        const next = vi.fn();

        await createItem(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(mocks.createItem).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    it('updates only forfeitPercent without losing existing freeDays', async () => {
        const item = existingItem();

        mocks.findItem.mockResolvedValue(item);

        const req = {
            params: { id: 'item-1' },
            user: { id: 'lender-1' },
            body: {
                cancellation: {
                    forfeitPercent: 40
                }
            }
        };

        const res = response();
        const next = vi.fn();

        await updateItem(req, res, next);

        expect(next).not.toHaveBeenCalled();

        expect(item.cancellation).toEqual({
            freeDays: 3,
            forfeitPercent: 40
        });

        expect(item.save).toHaveBeenCalledOnce();
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it('updates only freeDays without losing existing forfeitPercent', async () => {
        const item = existingItem();

        mocks.findItem.mockResolvedValue(item);

        const req = {
            params: { id: 'item-1' },
            user: { id: 'lender-1' },
            body: {
                cancellation: {
                    freeDays: 0
                }
            }
        };

        const res = response();
        const next = vi.fn();

        await updateItem(req, res, next);

        expect(next).not.toHaveBeenCalled();

        expect(item.cancellation).toEqual({
            freeDays: 0,
            forfeitPercent: 20
        });

        expect(item.save).toHaveBeenCalledOnce();
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it('rejects invalid cancellation settings on update without saving', async () => {
        const item = existingItem();

        mocks.findItem.mockResolvedValue(item);

        const req = {
            params: { id: 'item-1' },
            user: { id: 'lender-1' },
            body: {
                cancellation: {
                    forfeitPercent: 101
                }
            }
        };

        const res = response();
        const next = vi.fn();

        await updateItem(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(item.save).not.toHaveBeenCalled();
        expect(mocks.findItem).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });
});
