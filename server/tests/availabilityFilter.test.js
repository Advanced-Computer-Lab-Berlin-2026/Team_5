import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import app from "../app.js";
import { Item } from "../models/Item.js";
import { User } from "../models/User.js";
import { Reservation } from "../models/Reservation.js";

vi.mock('../models/Item.js', () => ({
    Item: { find: vi.fn(), countDocuments: vi.fn() }
}));

vi.mock('../models/User.js', () => ({
    User: { distinct: vi.fn() }
}));

vi.mock('../models/Reservation.js', () => ({
    Reservation: { distinct: vi.fn() },
    BLOCKING_STATUSES: ['pending', 'upcoming', 'active']
}));

const BASE_URL = '/api/items';
const VISIBLE = { archived: false, flagged: { $ne: true } };

const drill = { _id: 'ITM-00000001', name: 'Drill', category: 'Tools', photos: [], depositAmount: 40 };
const tent = { _id: 'ITM-00000002', name: 'Tent', category: 'Outdoor', photos: [], depositAmount: 60 };

function listItems(query) {
    return request(app).get(BASE_URL).query(query);
}

function sentFilter() {
    return Item.find.mock.calls[0][0];
}

beforeEach(() => {
    vi.resetAllMocks();

    Item.find.mockResolvedValue([tent]);
    Item.countDocuments.mockResolvedValue(1);
    User.distinct.mockResolvedValue([]);
    Reservation.distinct.mockResolvedValue([drill._id]);
});

describe('GET /api/items without a date range', () => {
    it('does not look at reservations', async () => {
        const response = await listItems({});

        expect(response.status).toBe(200);
        expect(Reservation.distinct).not.toHaveBeenCalled();
        expect(sentFilter()).toEqual(VISIBLE);
    });
});

describe('GET /api/items with a date range', () => {
    it('returns 200 for a guest without logging in', async () => {
        const response = await listItems({ startDate: '2026-12-01', endDate: '2026-12-05' });

        expect(response.status).toBe(200);
        expect(response.body.items).toEqual([tent]);
    });

    it('leaves out items with a reservation that overlaps the dates', async () => {
        await listItems({ startDate: '2026-12-01', endDate: '2026-12-05' });

        expect(Reservation.distinct).toHaveBeenCalledWith('item', {
            status: { $in: ['pending', 'upcoming', 'active'] },
            startDate: { $lt: new Date('2026-12-05T00:00:00Z') },
            endDate: { $gt: new Date('2026-12-01T00:00:00Z') }
        });
        expect(sentFilter()).toEqual({ ...VISIBLE, _id: { $nin: [drill._id] } });
    });

    it('uses the same filter for the total so the pagination stays right', async () => {
        const response = await listItems({ startDate: '2026-12-01', endDate: '2026-12-05' });

        expect(Item.countDocuments).toHaveBeenCalledWith({ ...VISIBLE, _id: { $nin: [drill._id] } });
        expect(response.body.pagination).toEqual({ total: 1, page: 1, totalPages: 1, limit: 10 });
    });

    it('keeps every item when nothing is booked in the range', async () => {
        Reservation.distinct.mockResolvedValue([]);

        await listItems({ startDate: '2026-12-01', endDate: '2026-12-05' });

        expect(sentFilter()).toEqual(VISIBLE);
    });

    it('combines the dates with category, search and suspended owners', async () => {
        User.distinct.mockResolvedValue(['banned']);

        await listItems({ startDate: '2026-12-01', endDate: '2026-12-05', category: 'Tools', search: 'dri' });

        expect(sentFilter()).toEqual({
            ...VISIBLE,
            category: 'Tools',
            name: { $regex: 'dri', $options: 'i' },
            owner: { $nin: ['banned'] },
            _id: { $nin: [drill._id] }
        });
    });

    it('accepts dates with a time', async () => {
        const response = await listItems({ startDate: '2026-12-01T10:00:00Z', endDate: '2026-12-01T18:00:00Z' });

        expect(response.status).toBe(200);
    });

    it.each([
        ['only a start date', { startDate: '2026-12-01' }],
        ['only an end date', { endDate: '2026-12-05' }],
        ['an end date before the start date', { startDate: '2026-12-05', endDate: '2026-12-01' }],
        ['the same start and end date', { startDate: '2026-12-01', endDate: '2026-12-01' }],
        ['a date that is not a date', { startDate: 'tomorrow', endDate: '2026-12-05' }]
    ])('returns 400 for %s', async (_case, query) => {
        const response = await listItems(query);

        expect(response.status).toBe(400);
        expect(Reservation.distinct).not.toHaveBeenCalled();
        expect(Item.find).not.toHaveBeenCalled();
    });

    it('returns 500 when the reservation lookup fails', async () => {
        Reservation.distinct.mockRejectedValue(new Error('Database unavailable'));

        const response = await listItems({ startDate: '2026-12-01', endDate: '2026-12-05' });

        expect(response.status).toBe(500);
        expect(response.body).toEqual({ message: 'Server Error' });
    });
});

vi.mock('../models/Waitlist.js', () => ({ Waitlist: { distinct: vi.fn(async () => []) } }));
