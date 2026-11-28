import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { Item } from '../models/Item.js';
import { Reservation } from '../models/Reservation.js';
import { User } from '../models/User.js';

vi.mock('../models/Item.js', () => ({
    Item: { findOne: vi.fn(), find: vi.fn() }
}));
vi.mock('../models/User.js', () => ({ User: { distinct: vi.fn() } }));
vi.mock('../models/Reservation.js', async (importOriginal) => ({
    ...(await importOriginal()),
    Reservation: { distinct: vi.fn() }
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
    User.distinct.mockResolvedValue([]);
    Reservation.distinct.mockResolvedValue([]);
    Item.findOne.mockImplementation(findItem);
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
        expect(Item.findOne).toHaveBeenCalledExactlyOnceWith(
            { _id: itemId, archived: false, flagged: { $ne: true } },
            { category: 1, attributes: 1 }
        );
        expect(Item.find).toHaveBeenCalledExactlyOnceWith(
            {
                _id: { $nin: [itemId] },
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
        expect(Item.findOne).not.toHaveBeenCalled();
    });

    it('excludes overlapping bookings and suspended lenders from dated alternatives', async () => {
        User.distinct.mockResolvedValue(['suspended']);
        Reservation.distinct.mockResolvedValue([itemId, 'ITM-00000003']);

        const response = await list(itemId).query({ startDate: '2030-01-01', endDate: '2030-01-03' });

        expect(response.status).toBe(200);
        expect(Reservation.distinct).toHaveBeenCalledExactlyOnceWith('item', {
            status: { $in: ['pending', 'upcoming', 'active'] },
            startDate: { $lt: new Date('2030-01-03') },
            endDate: { $gt: new Date('2030-01-01') }
        });
        expect(Item.find).toHaveBeenCalledWith(expect.objectContaining({
            _id: { $nin: [itemId, 'ITM-00000003'] },
            owner: { $nin: ['suspended'] }
        }), expect.anything(), expect.anything());
        expect(Item.findOne).toHaveBeenCalledWith(
            expect.objectContaining({ owner: { $nin: ['suspended'] } }), expect.anything()
        );
    });

    it.each([
        { startDate: '2030-01-01' },
        { startDate: '2030-01-03', endDate: '2030-01-01' },
        { startDate: 'invalid', endDate: '2030-01-03' }
    ])('rejects an invalid date range', async (query) => {
        const response = await list(itemId).query(query);

        expect(response.status).toBe(400);
        expect(Item.findOne).not.toHaveBeenCalled();
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

vi.mock('../models/Waitlist.js', () => ({ Waitlist: { distinct: vi.fn(async () => []) } }));
