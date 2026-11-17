import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../app.js";
import { env } from "../config/env.js";
import { User } from "../models/User.js";
import { Reservation } from "../models/Reservation.js";

vi.mock('../models/User.js', () => ({
    User: { findById: vi.fn() }
}));

vi.mock('../models/Reservation.js', () => ({
    Reservation: { aggregate: vi.fn() },
    BLOCKING_STATUSES: []
}));

const ADMIN_ID = 'admin1';
const BASE_URL = '/api/admin/reports/usage';
const ORIGIN = 'http://localhost:3000';

const drillRow = { itemId: 'ITM-1', name: 'Drill', category: 'Power Tools', reservations: 3, daysReserved: 9, deposits: 600 };
const sawRow = { itemId: 'ITM-2', name: 'Saw', category: 'Power Tools', reservations: 1, daysReserved: 2, deposits: 150 };
const tentRow = { itemId: 'ITM-3', name: 'Tent', category: 'Camping', reservations: 2, daysReserved: 6, deposits: 200 };

let loggedInRole;

function findUserById(id) {
    return Promise.resolve(id === ADMIN_ID ? { _id: ADMIN_ID, role: loggedInRole, suspended: false } : null);
}

function loginCookie(role) {
    loggedInRole = role;
    return `accessToken=${jwt.sign({ id: ADMIN_ID, role }, env.jwtSecret, { expiresIn: '15m' })}`;
}

function asAdmin(req) {
    return req.set('Cookie', loginCookie('admin')).set('Origin', ORIGIN);
}

function sentPipeline() {
    return Reservation.aggregate.mock.calls[0][0];
}

beforeEach(() => {
    vi.resetAllMocks();

    User.findById.mockImplementation(findUserById);
    Reservation.aggregate.mockResolvedValue([drillRow, sawRow, tentRow]);
});

describe('Admin access', () => {
    it('returns 401 when not logged in', async () => {
        const response = await request(app).get(BASE_URL);

        expect(response.status).toBe(401);
    });

    it.each(['member', 'lender'])('returns 403 when the user is a %s', async (role) => {
        const response = await request(app)
            .get(BASE_URL)
            .set('Cookie', loginCookie(role));

        expect(response.status).toBe(403);
        expect(Reservation.aggregate).not.toHaveBeenCalled();
    });
});

describe('GET /api/admin/reports/usage', () => {
    it('returns 200 with the usage per item and per category for the chosen month', async () => {
        const response = await asAdmin(request(app).get(`${BASE_URL}?month=2026-09`));

        expect(response.status).toBe(200);
        expect(response.body.report.period.label).toBe('2026-09');
        expect(response.body.report.items).toEqual([drillRow, sawRow, tentRow]);
        expect(response.body.report.categories).toEqual([
            { category: 'Power Tools', items: 2, reservations: 4, daysReserved: 11, deposits: 750 },
            { category: 'Camping', items: 1, reservations: 2, daysReserved: 6, deposits: 200 }
        ]);
        expect(response.body.report.totals).toEqual({ reservations: 6, items: 3, categories: 2 });
    });

    it('only counts confirmed reservations that start inside the month', async () => {
        await asAdmin(request(app).get(`${BASE_URL}?month=2026-12`));

        const [match] = sentPipeline();
        expect(match.$match.status).toEqual({ $in: ['upcoming', 'active', 'completed'] });
        expect(match.$match.startDate).toEqual({
            $gte: new Date('2026-12-01T00:00:00Z'),
            $lt: new Date('2027-01-01T00:00:00Z')
        });
    });

    it('uses the current month when no month is given', async () => {
        const response = await asAdmin(request(app).get(BASE_URL));

        expect(response.status).toBe(200);
        expect(response.body.report.period.label).toBe(new Date().toISOString().slice(0, 7));
    });

    it('returns an empty report for a month without reservations', async () => {
        Reservation.aggregate.mockResolvedValue([]);

        const response = await asAdmin(request(app).get(`${BASE_URL}?month=2026-01`));

        expect(response.status).toBe(200);
        expect(response.body.report.items).toEqual([]);
        expect(response.body.report.categories).toEqual([]);
        expect(response.body.report.totals).toEqual({ reservations: 0, items: 0, categories: 0 });
    });

    it('returns 500 when the database fails', async () => {
        Reservation.aggregate.mockRejectedValue(new Error('Database unavailable'));

        const response = await asAdmin(request(app).get(`${BASE_URL}?month=2026-09`));

        expect(response.status).toBe(500);
        expect(response.body).toEqual({ message: 'Server Error' });
    });
});

describe('Filtering the usage report', () => {
    it('filters by item', async () => {
        const response = await asAdmin(request(app).get(`${BASE_URL}?month=2026-09&item=ITM-1`));

        expect(response.status).toBe(200);
        expect(sentPipeline()[0].$match.item).toBe('ITM-1');
        expect(response.body.report.filters).toEqual({ item: 'ITM-1', category: null });
    });

    it('filters by category after the item details are joined', async () => {
        const response = await asAdmin(request(app).get(`${BASE_URL}?month=2026-09&category=Power%20Tools`));

        expect(response.status).toBe(200);
        const pipeline = sentPipeline();
        const unwindIndex = pipeline.findIndex((stage) => stage.$unwind);
        expect(pipeline[unwindIndex + 1]).toEqual({ $match: { 'itemDoc.category': 'Power Tools' } });
        expect(response.body.report.filters).toEqual({ item: null, category: 'Power Tools' });
    });

    it('does not filter by category when none is given', async () => {
        await asAdmin(request(app).get(`${BASE_URL}?month=2026-09`));

        expect(sentPipeline()).not.toContainEqual({ $match: { 'itemDoc.category': expect.anything() } });
    });

    it('filters by a date range that includes the last day', async () => {
        const response = await asAdmin(request(app).get(`${BASE_URL}?from=2026-09-05&to=2026-09-20`));

        expect(response.status).toBe(200);
        expect(response.body.report.period.label).toBe('2026-09-05 to 2026-09-20');
        expect(sentPipeline()[0].$match.startDate).toEqual({
            $gte: new Date('2026-09-05T00:00:00Z'),
            $lt: new Date('2026-09-21T00:00:00Z')
        });
    });

    it('combines the item, category and date filters', async () => {
        await asAdmin(request(app).get(`${BASE_URL}?from=2026-09-01&to=2026-09-30&item=ITM-1&category=Power%20Tools`));

        const pipeline = sentPipeline();
        expect(pipeline[0].$match.item).toBe('ITM-1');
        expect(pipeline).toContainEqual({ $match: { 'itemDoc.category': 'Power Tools' } });
    });

    it.each([
        ['a month that does not exist', '?month=2026-13'],
        ['a month in the wrong format', '?month=09-2026'],
        ['from without to', '?from=2026-09-01'],
        ['to without from', '?to=2026-09-01'],
        ['to before from', '?from=2026-09-10&to=2026-09-01'],
        ['a month and a date range together', '?month=2026-09&from=2026-09-01&to=2026-09-02'],
        ['an invalid date', '?from=2026-02-31x&to=2026-03-01'],
        ['an unknown filter', '?owner=martinies']
    ])('returns 400 for %s', async (_case, query) => {
        const response = await asAdmin(request(app).get(`${BASE_URL}${query}`));

        expect(response.status).toBe(400);
        expect(response.body.message).toEqual(expect.any(String));
        expect(Reservation.aggregate).not.toHaveBeenCalled();
    });
});
