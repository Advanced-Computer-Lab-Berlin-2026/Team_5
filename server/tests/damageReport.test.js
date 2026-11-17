import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../app.js";
import { env } from "../config/env.js";
import { User } from "../models/User.js";
import { Reservation } from "../models/Reservation.js";
import { DamageReport } from "../models/DamageReport.js";

vi.mock('../models/User.js', () => ({
    User: { findById: vi.fn() }
}));

vi.mock('../models/Reservation.js', () => ({
    Reservation: { find: vi.fn() },
    BLOCKING_STATUSES: []
}));

vi.mock('../models/DamageReport.js', () => ({
    DamageReport: { find: vi.fn() }
}));

const ADMIN_ID = 'admin1';
const BASE_URL = '/api/admin/reports/damage';
const ORIGIN = 'http://localhost:3000';

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

function fakeQuery(result) {
    const query = { select: vi.fn(), sort: vi.fn(), populate: vi.fn(), lean: vi.fn().mockResolvedValue(result) };
    query.select.mockReturnValue(query);
    query.sort.mockReturnValue(query);
    query.populate.mockReturnValue(query);
    return query;
}

function fakeEntry(id, reservation, type, day) {
    return {
        _id: id,
        reservation,
        type,
        returnCondition: `${type} condition`,
        report: { message: `${type} message` },
        createdAt: new Date(`2026-09-${String(day).padStart(2, '0')}T10:00:00Z`)
    };
}

const damageEntries = [
    fakeEntry('DMG-1', 'RES-A', 'report', 10),
    fakeEntry('DMG-2', 'RES-A', 'dispute', 11),
    { ...fakeEntry('DMG-3', 'RES-A', 'resolution', 14), depositForfeit: 300 },
    fakeEntry('DMG-4', 'RES-B', 'report', 12),
    fakeEntry('DMG-5', 'RES-C', 'report', 13),
    { ...fakeEntry('DMG-6', 'RES-C', 'resolution', 15), depositForfeit: 50 }
];

const reservations = [
    { _id: 'RES-A', borrower: 'elBary', lender: 'shikselbeks', payment: { depositAmount: 1500 }, item: { _id: 'ITM-5', name: 'Camera', category: 'Electronics' } },
    { _id: 'RES-C', borrower: 'Youries', lender: 'martinies', payment: { depositAmount: 100 }, item: { _id: 'ITM-6', name: 'Ladder', category: 'Garden' } }
];

function findCase(response, reservationId) {
    return response.body.report.cases.find((damageCase) => damageCase.reservation === reservationId);
}

beforeEach(() => {
    vi.resetAllMocks();

    User.findById.mockImplementation(findUserById);
    DamageReport.find.mockReturnValue(fakeQuery(damageEntries));
    Reservation.find.mockReturnValue(fakeQuery(reservations));
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
        expect(DamageReport.find).not.toHaveBeenCalled();
    });
});

describe('GET /api/admin/reports/damage', () => {
    it('returns 200 with one case per reservation and a summary per status', async () => {
        const response = await asAdmin(request(app).get(BASE_URL));

        expect(response.status).toBe(200);
        expect(response.body.report.cases).toHaveLength(3);
        expect(response.body.report.summary).toEqual({ total: 3, 'pending-review': 1, decided: 1, disputed: 0, resolved: 1 });
    });

    it('shows the newest case first', async () => {
        const response = await asAdmin(request(app).get(BASE_URL));

        const order = response.body.report.cases.map((damageCase) => damageCase.reservation);
        expect(order).toEqual(['RES-C', 'RES-B', 'RES-A']);
    });

    it('adds the reservation details and the full history to each case', async () => {
        const response = await asAdmin(request(app).get(BASE_URL));

        const damageCase = findCase(response, 'RES-A');
        expect(damageCase).toMatchObject({
            item: { id: 'ITM-5', name: 'Camera', category: 'Electronics' },
            borrower: 'elBary',
            lender: 'shikselbeks',
            depositAmount: 1500,
            depositForfeit: 300,
            disputed: true,
            openedAt: '2026-09-10T10:00:00.000Z',
            lastUpdatedAt: '2026-09-14T10:00:00.000Z'
        });
        expect(damageCase.history.map((step) => step.type)).toEqual(['report', 'dispute', 'resolution']);
        expect(damageCase.history[0]).toMatchObject({ id: 'DMG-1', message: 'report message', returnCondition: 'report condition' });
    });

    it('still lists a case whose reservation was deleted', async () => {
        const response = await asAdmin(request(app).get(BASE_URL));

        expect(findCase(response, 'RES-B')).toMatchObject({
            status: 'pending-review',
            item: null,
            borrower: null,
            lender: null,
            depositAmount: null,
            depositForfeit: null
        });
    });

    it('loads only the reservations that have damage reports, without the photos', async () => {
        await asAdmin(request(app).get(BASE_URL));

        expect(DamageReport.find.mock.results[0].value.select).toHaveBeenCalledWith('-report.photos');
        expect(Reservation.find).toHaveBeenCalledWith({ _id: { $in: ['RES-A', 'RES-B', 'RES-C'] } });
        expect(Reservation.find.mock.results[0].value.populate).toHaveBeenCalledWith('item', 'name category');
    });

    it('returns an empty report when there are no damage reports', async () => {
        DamageReport.find.mockReturnValue(fakeQuery([]));
        Reservation.find.mockReturnValue(fakeQuery([]));

        const response = await asAdmin(request(app).get(BASE_URL));

        expect(response.status).toBe(200);
        expect(response.body.report.cases).toEqual([]);
        expect(response.body.report.summary.total).toBe(0);
    });

    it('returns 500 when the database fails', async () => {
        DamageReport.find.mockImplementation(() => {
            throw new Error('Database unavailable');
        });

        const response = await asAdmin(request(app).get(BASE_URL));

        expect(response.status).toBe(500);
        expect(response.body).toEqual({ message: 'Server Error' });
    });
});

describe('Resolution status', () => {
    it.each([
        [['report'], 'pending-review', false],
        [['report', 'resolution'], 'decided', false],
        [['report', 'resolution', 'dispute'], 'disputed', true],
        [['report', 'dispute'], 'disputed', true],
        [['report', 'resolution', 'dispute', 'resolution'], 'resolved', true]
    ])('marks %j as %s', async (types, status, disputed) => {
        DamageReport.find.mockReturnValue(fakeQuery(types.map((type, index) => fakeEntry(`DMG-${index}`, 'RES-A', type, index + 1))));

        const response = await asAdmin(request(app).get(BASE_URL));

        expect(findCase(response, 'RES-A')).toMatchObject({ status, disputed });
    });

    it('uses the forfeit of the latest resolution', async () => {
        DamageReport.find.mockReturnValue(fakeQuery([
            fakeEntry('DMG-1', 'RES-A', 'report', 1),
            { ...fakeEntry('DMG-2', 'RES-A', 'resolution', 2), depositForfeit: 500 },
            fakeEntry('DMG-3', 'RES-A', 'dispute', 3),
            { ...fakeEntry('DMG-4', 'RES-A', 'resolution', 4), depositForfeit: 200 }
        ]));

        const response = await asAdmin(request(app).get(BASE_URL));

        expect(findCase(response, 'RES-A').depositForfeit).toBe(200);
    });
});

describe('Filtering by status', () => {
    it('returns only the cases with that status but keeps the full summary', async () => {
        const response = await asAdmin(request(app).get(`${BASE_URL}?status=resolved`));

        expect(response.status).toBe(200);
        expect(response.body.report.cases.map((damageCase) => damageCase.reservation)).toEqual(['RES-A']);
        expect(response.body.report.summary.total).toBe(3);
        expect(response.body.report.filters).toEqual({ status: 'resolved' });
    });

    it.each(['open', 'RESOLVED', ''])('returns 400 for the status "%s"', async (status) => {
        const response = await asAdmin(request(app).get(`${BASE_URL}?status=${status}`));

        expect(response.status).toBe(400);
        expect(DamageReport.find).not.toHaveBeenCalled();
    });
});
