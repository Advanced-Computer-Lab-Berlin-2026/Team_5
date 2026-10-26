import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { Item } from '../models/index.js';

// I mock only the 2 Item functions the list endpoint calls
vi.mock('../models/Item.js', () => ({
    Item: { find: vi.fn(), countDocuments: vi.fn() }
}));

const drill = { _id: 'ITM-1', name: 'Power Drill', category: 'Tools', photos: [{ url: 'https://img/drill.jpg' }], depositAmount: 40 };
const ladder = { _id: 'ITM-2', name: 'Ladder', category: 'Tools', photos: [], depositAmount: 25 };

const list = query => request(app).get('/api/items').query(query ?? {});

beforeEach(() => {
    vi.resetAllMocks();
    Item.find.mockResolvedValue([drill, ladder]);
    Item.countDocuments.mockResolvedValue(2);
});

describe('GET /api/items', () => {
    it('returns the first page of available items with pagination', async () => {
        const response = await list();

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            items: [drill, ladder],
            pagination: { total: 2, page: 1, totalPages: 1, limit: 10 }
        });
        expect(Item.find).toHaveBeenCalledExactlyOnceWith(
            { archived: false },
            'name category photos depositAmount',
            { sort: { createdAt: -1, _id: 1 }, skip: 0, limit: 10, lean: true }
        );
        expect(Item.countDocuments).toHaveBeenCalledExactlyOnceWith({ archived: false });
    });

    it('skips earlier pages and counts total pages', async () => {
        Item.countDocuments.mockResolvedValue(12);

        const response = await list({ page: 3, limit: 5 });

        expect(response.status).toBe(200);
        expect(response.body.pagination).toEqual({ total: 12, page: 3, totalPages: 3, limit: 5 });
        const options = Item.find.mock.calls[0][2];
        expect(options.skip).toBe(10);
        expect(options.limit).toBe(5);
    });

    it('filters by category', async () => {
        await list({ category: ' Tools ' });

        expect(Item.find.mock.calls[0][0]).toEqual({ archived: false, category: 'Tools' });
        expect(Item.countDocuments).toHaveBeenCalledWith({ archived: false, category: 'Tools' });
    });

    it.each([
        [undefined, false],
        ['false', false],
        ['true', true]
    ])('uses archived=%s as %s', async (archived, expected) => {
        await list(archived === undefined ? {} : { archived });

        expect(Item.find.mock.calls[0][0].archived).toBe(expected);
    });

    it('searches names through the text index', async () => {
        await list({ search: ' drill ' });

        const filter = Item.find.mock.calls[0][0];
        expect(filter.$text).toEqual({ $search: 'drill' });
        expect(Item.countDocuments).toHaveBeenCalledWith(filter);
    });

    it('combines search, category and archived in one filter', async () => {
        await list({ search: 'drill', category: 'Tools', archived: 'true' });

        expect(Item.find.mock.calls[0][0]).toEqual({
            archived: true,
            category: 'Tools',
            $text: { $search: 'drill' }
        });
    });

    it('returns an empty list when nothing matches', async () => {
        Item.find.mockResolvedValue([]);
        Item.countDocuments.mockResolvedValue(0);

        const response = await list({ search: 'submarine' });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            items: [],
            pagination: { total: 0, page: 1, totalPages: 0, limit: 10 }
        });
    });

    it('returns an empty page past the last one', async () => {
        Item.find.mockResolvedValue([]);
        Item.countDocuments.mockResolvedValue(3);

        const response = await list({ page: 5 });

        expect(response.status).toBe(200);
        expect(response.body.items).toEqual([]);
        expect(response.body.pagination.totalPages).toBe(1);
    });

    it.each([
        { page: 0 },
        { page: -1 },
        { page: 1.5 },
        { page: 'abc' },
        { limit: 0 },
        { limit: 51 },
        { archived: 'maybe' },
        { category: '' },
        { search: '   ' },
        { search: 'x'.repeat(101) },
        { sort: 'name' }
    ])('returns 400 for invalid query %o', async query => {
        const response = await list(query);

        expect(response.status).toBe(400);
        expect(Item.find).not.toHaveBeenCalled();
        expect(Item.countDocuments).not.toHaveBeenCalled();
    });

    it.each(['find', 'countDocuments'])('returns 500 when %s fails', async operation => {
        Item[operation].mockRejectedValue(new Error('Database unavailable'));

        const response = await list();

        expect(response.status).toBe(500);
        expect(response.body).not.toHaveProperty('items');
    });
});
