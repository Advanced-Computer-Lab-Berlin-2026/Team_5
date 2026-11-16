import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { Item } from '../models/Item.js';

vi.mock('../models/Item.js', () => ({
    Item: { findById: vi.fn(), find: vi.fn() }
}));

const itemId = 'ITM-1a2b3c4d';
const itemQuery = { lean: vi.fn() };
const findItem = () => itemQuery;
const list = id => request(app).get(`/api/alternatives/${id}`);

beforeEach(() => {
    vi.resetAllMocks();
    itemQuery.lean.mockResolvedValue({
        _id: itemId,
        category: 'Tools',
        attributes: [{ key: 'brand', value: 'Bosh' }, { key: 'power', value: 'Cordless' }]
    });
    Item.findById.mockImplementation(findItem);
    Item.find.mockResolvedValue([
        { _id: 'ITM-00000001', attributes: [{ key: 'brand', value: 'Bosh' }] },
        { _id: 'ITM-00000002', attributes: [{ key: 'brand', value: 'Other' }] },
        { _id: 'ITM-00000003', attributes: [{ key: 'brand', value: 'Bosh' }, { key: 'power', value: 'Cordless' }] }
    ]);
});

describe('GET /api/alternatives/:itemId', () => {
    it('returns same-category available items ranked by matching attributes', async () => {
        const response = await list(itemId);

        expect(response.status).toBe(200);
        expect(response.body.items.map(item => item._id)).toEqual([
            'ITM-00000003',
            'ITM-00000001',
            'ITM-00000002'
        ]);
        expect(Item.findById).toHaveBeenCalledExactlyOnceWith(itemId, { category: 1, attributes: 1 });
        expect(Item.find).toHaveBeenCalledExactlyOnceWith(
            {
                _id: { $ne: itemId },
                category: 'Tools',
                archived: false,
                flagged: { $ne: true }
            },
            { name: 1, category: 1, photos: 1, depositAmount: 1, attributes: 1 },
            { sort: { createdAt: -1, _id: 1 }, lean: true }
        );
    });

    it('returns 400 for an invalid item id', async () => {
        const response = await list('invalid');

        expect(response.status).toBe(400);
        expect(Item.findById).not.toHaveBeenCalled();
    });

    it('returns 404 when the source item does not exist', async () => {
        itemQuery.lean.mockResolvedValue(null);

        const response = await list(itemId);

        expect(response.status).toBe(404);
        expect(Item.find).not.toHaveBeenCalled();
    });

    it('forwards database errors to the error handler', async () => {
        itemQuery.lean.mockRejectedValue(new Error('Database unavailable'));

        const response = await list(itemId);

        expect(response.status).toBe(500);
    });
});
