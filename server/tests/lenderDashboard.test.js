import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../app.js";
import { env } from "../config/env.js";
import { User } from "../models/User.js";
import { Item } from "../models/Item.js";
import { Reservation } from "../models/Reservation.js";
import { Payment } from '../models/Payment.js';
import { DamageReport } from "../models/DamageReport.js";

vi.mock('../models/User.js', () => ({
    User: { findById: vi.fn() }
}));

vi.mock('../models/Item.js', () => ({
    Item: { countDocuments: vi.fn() }
}));

vi.mock('../models/Reservation.js', () => ({
    Reservation: { find: vi.fn() },
    BLOCKING_STATUSES: []
}));

vi.mock('../models/DamageReport.js', () => ({
    DamageReport: { distinct: vi.fn() }
}));

vi.mock('../models/Payment.js', () => ({ Payment: { find: vi.fn() } }));

const LENDER_ID = 'martinies';
const BASE_URL = '/api/lender/dashboard';
const ORIGIN = 'http://localhost:3000';

const lentReservations = [
    { _id: 'RES-1', item: 'ITM-1', payment: { depositAmount: 180 } },
    { _id: 'RES-2', item: 'ITM-1', payment: { depositAmount: 180 } },
    { _id: 'RES-3', item: 'ITM-2', payment: { depositAmount: 500 } },
    { _id: 'RES-4', item: 'ITM-3', payment: {} }
];

let loggedInRole;

function findUserById(id) {
    return Promise.resolve(id === LENDER_ID ? { _id: LENDER_ID, role: loggedInRole, suspended: false } : null);
}

function loginCookie(role) {
    loggedInRole = role;
    return `accessToken=${jwt.sign({ id: LENDER_ID, role }, env.jwtSecret, { expiresIn: '15m' })}`;
}

function asLender(req) {
    return req.set('Cookie', loginCookie('lender')).set('Origin', ORIGIN);
}

function fakeQuery(result) {
    const query = { select: vi.fn(), lean: vi.fn().mockResolvedValue(result) };
    query.select.mockReturnValue(query);
    return query;
}

beforeEach(() => {
    vi.resetAllMocks();

    User.findById.mockImplementation(findUserById);
    Item.countDocuments.mockResolvedValue(4);
    Reservation.find.mockReturnValue(fakeQuery(lentReservations));
    DamageReport.distinct.mockResolvedValue(['RES-3']);
    Payment.find.mockReturnValue(fakeQuery([{ reservation: 'RES-1' }, { reservations: ['RES-2', 'RES-3'] }]));
});

describe('Lender access', () => {
    it('returns 401 when not logged in', async () => {
        const response = await request(app).get(BASE_URL);

        expect(response.status).toBe(401);
    });

    it.each(['member', 'admin'])('returns 403 when the user is a %s', async (role) => {
        const response = await request(app)
            .get(BASE_URL)
            .set('Cookie', loginCookie(role));

        expect(response.status).toBe(403);
        expect(Reservation.find).not.toHaveBeenCalled();
    });
});

describe('GET /api/lender/dashboard', () => {
    it('returns 200 with the items lent, deposits collected and damage incident rate', async () => {
        const response = await asLender(request(app).get(BASE_URL));

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            dashboard: {
                listedItems: 4,
                itemsLent: { timesLent: 4, distinctItems: 3 },
                totalDepositsCollected: 860,
                damageIncidents: 1,
                damageIncidentRate: 25
            }
        });
    });

    it('only reads the data of the logged-in lender', async () => {
        await asLender(request(app).get(BASE_URL));

        expect(Item.countDocuments).toHaveBeenCalledWith({ owner: LENDER_ID });
        expect(Reservation.find).toHaveBeenCalledWith({ lender: LENDER_ID, status: { $in: ['active', 'completed'] } });
    });

    it('counts a reservation with a damage report once', async () => {
        await asLender(request(app).get(BASE_URL));

        expect(DamageReport.distinct).toHaveBeenCalledWith('reservation', {
            reservation: { $in: ['RES-1', 'RES-2', 'RES-3', 'RES-4'] },
            type: 'report'
        });
    });

    it('rounds the damage incident rate to one decimal', async () => {
        Reservation.find.mockReturnValue(fakeQuery(lentReservations.slice(0, 3)));

        const response = await asLender(request(app).get(BASE_URL));

        expect(response.body.dashboard.damageIncidentRate).toBe(33.3);
    });

    it('returns zeros for a lender who has not lent anything yet', async () => {
        Item.countDocuments.mockResolvedValue(0);
        Reservation.find.mockReturnValue(fakeQuery([]));

        const response = await asLender(request(app).get(BASE_URL));

        expect(response.status).toBe(200);
        expect(response.body.dashboard).toEqual({
            listedItems: 0,
            itemsLent: { timesLent: 0, distinctItems: 0 },
            totalDepositsCollected: 0,
            damageIncidents: 0,
            damageIncidentRate: 0
        });
        expect(DamageReport.distinct).not.toHaveBeenCalled();
    });

    it('returns 500 when the database fails', async () => {
        Item.countDocuments.mockRejectedValue(new Error('Database unavailable'));

        const response = await asLender(request(app).get(BASE_URL));

        expect(response.status).toBe(500);
        expect(response.body).toEqual({ message: 'Server Error' });
    });
});
