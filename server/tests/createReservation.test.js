import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import app from "../app.js";
import { User } from "../models/User.js";
import { Item } from "../models/Item.js";
import { requireAuth } from "../middleware/auth.js";
import { Reservation } from "../models/Reservation.js";
import mongoose from "mongoose";

vi.mock('../models/User.js', () => ({
    User: { findById: vi.fn() }
}));

vi.mock('../models/Item.js', () => ({
    Item: { findOne: vi.fn(), updateOne: vi.fn() }
}));

vi.mock('../models/Reservation.js', () => {
    const Reservation = vi.fn();
    Reservation.findOverlap = vi.fn();
    return { Reservation };
});

// replace only requireAuth, keep the other exports of the file
vi.mock('../middleware/auth.js', async (importOriginal) => ({
    ...(await importOriginal()),
    requireAuth: vi.fn()
}));

const TRUSTED_ORIGIN = 'http://localhost:3000';

function authenticateAs(id = 'member123', role = 'member') {
    requireAuth.mockImplementation((req, res, next) => {
        req.user = { id, role };
        next();
    });
}

function rejectAuth() {
    requireAuth.mockImplementation((req, res) =>
        res.status(401).json({ message: 'Authentication required' })
    );
}

// item ids are ITM- followed by 8 lowercase hex characters
const validItemId = 'ITM-1a2b3c4d';
const validBody = {
    itemId: validItemId,
    startDate: '2030-07-01',
    endDate: '2030-07-05'
};
const invalidItemIds = ['abc', 'not-an-item-id', '123', 'ITM-1a2b3c4Z', 'ITM-1a2b3c4', '64b7f0c2e4b0a1a2b3c4d5e6'];

const deliveryAddress = '12 Test Street, Berlin';

function makeItem(overrides = {}) {
    return {
        _id: validItemId,
        owner: 'lender123',
        depositAmount: 100,
        borrowingRules: { maxDurationDays: 7, minTrustScore: 0 },
        delivery: { offered: false, fee: 10 },
        ...overrides
    };
}

function post(body = validBody) {
    return request(app)
        .post('/api/reservations')
        .set('Origin', TRUSTED_ORIGIN)
        .send(body);
}

let session;

beforeEach(() => {
    vi.resetAllMocks();

    // default happy baseline
    authenticateAs();

    Item.findOne.mockResolvedValue(makeItem());
    Item.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });

    User.findById.mockResolvedValueOnce({ _id: 'member123', role: 'member', trustScore: 50 });
    User.findById.mockResolvedValueOnce({ _id: 'lender123', role: 'lender', suspended: false });

    Reservation.findOverlap.mockResolvedValue(null);

    Reservation.mockImplementation(function () {
        this._id = 'RES-12345678';
        this.save = vi.fn().mockResolvedValue(this);
    });

    session = {
        withTransaction: async (fn) => {
            await fn();
        },
        endSession: vi.fn()
    };
    vi.spyOn(mongoose, 'startSession').mockResolvedValue(session);
});

describe('POST /api/reservations', () => {
    it('returns 401 if not authenticated', async () => {
        rejectAuth();
        const response = await post();
        expect(response.status).toBe(401);
        expect(response.body).toEqual({ message: 'Authentication required' });
    });

    it('returns 400 if itemId is missing', async () => {
        const response = await post({ ...validBody, itemId: undefined });
        expect(response.status).toBe(400);
        expect(response.body.message).toMatch(/Missing required fields/);
    });

    it('returns 404 if item does not exist', async () => {
        Item.findOne.mockResolvedValue(null);
        const response = await post();
        expect(response.status).toBe(404);
        expect(response.body.message).toMatch(/Item not found or unavailable/);
    });

    it('returns 400 for every malformed item id', async () => {
        for (const itemId of invalidItemIds) {
            const response = await post({ ...validBody, itemId });
            expect(response.status, `itemId: ${itemId}`).toBe(400);
            expect(response.body.message, `itemId: ${itemId}`).toMatch(/Invalid item id format/);
        }
    });

    it('returns 400 if end date is before start date', async () => {
        const response = await post({
            ...validBody,
            startDate: validBody.endDate,
            endDate: validBody.startDate
        });
        expect(response.status).toBe(400);
        expect(response.body.message).toMatch(/Start date must be before end date/);
    });

    it('returns 400 if a date is not parseable', async () => {
        const response = await post({ ...validBody, startDate: 'not-a-date' });
        expect(response.status).toBe(400);
        expect(response.body.message).toMatch(/Invalid date format/);
    });

    it('returns 400 if the user reserves their own item', async () => {
        authenticateAs('lender123');
        const response = await post();
        expect(response.status).toBe(400);
        expect(response.body.message).toMatch(/Cannot reserve your own item/);
    });

    it('returns 400 if delivery is requested but not offered', async () => {
        const response = await post({
            ...validBody,
            deliveryFlag: true,
            deliveryAddress
        });
        expect(response.status).toBe(400);
        expect(response.body.message).toMatch(/Item does not allow delivery/);
    });

    it('returns 400 if the reservation exceeds the maximum duration', async () => {
        const response = await post({ ...validBody, endDate: '2030-07-20' });
        expect(response.status).toBe(400);
        expect(response.body.message).toMatch(/exceeds maximum/);
    });

    it('returns 403 if the borrower trust score is too low', async () => {
        Item.findOne.mockResolvedValue(
            makeItem({ borrowingRules: { maxDurationDays: 7, minTrustScore: 80 } })
        );
        const response = await post();
        expect(response.status).toBe(403);
        expect(response.body.message).toMatch(/minimum trust score/);
    });

    it('returns 403 if the lender is suspended', async () => {
        User.findById.mockReset();
        User.findById.mockResolvedValueOnce({ _id: 'member123', role: 'member', trustScore: 50 });
        User.findById.mockResolvedValueOnce({ _id: 'lender123', role: 'lender', suspended: true });
        const response = await post();
        expect(response.status).toBe(403);
        expect(response.body.message).toMatch(/Lender is suspended/);
    });

    it('returns 400 if the start date is in the past', async () => {
        const response = await post({
            ...validBody,
            startDate: '2020-07-01',
            endDate: '2020-07-05'
        });
        expect(response.status).toBe(400);
        expect(response.body.message).toMatch(/Start date cannot be in the past/);
    });

    it('returns 409 on overlapping reservation and ends the session', async () => {
        Reservation.findOverlap.mockResolvedValue({ _id: 'RES-existing' });
        const response = await post();
        expect(response.status).toBe(409);
        expect(Reservation).not.toHaveBeenCalled();
        expect(session.endSession).toHaveBeenCalled();
    });

    it('creates a reservation (happy path)', async () => {
        const response = await post();
        expect(response.status).toBe(201);
        expect(response.body.reservationId).toBe('RES-12345678');
        expect(Reservation.mock.calls[0][0].payment).toEqual({
            depositAmount: 100,
            method: 'wallet',
            depositCollected: false
        });

        // third argument is the session, either passed directly or as { session }
        const options = Item.updateOne.mock.calls[0][2];
        expect(options?.session ?? options).toBe(session);
    });

    it('creates a reservation with delivery', async () => {
        Item.findOne.mockResolvedValue(
            makeItem({ delivery: { offered: true, fee: 30 } })
        );
        const response = await post({
            ...validBody,
            deliveryFlag: true,
            deliveryAddress
        });
        expect(response.status).toBe(201);
        expect(Reservation.mock.calls[0][0].delivery).toEqual({
            address: deliveryAddress,
            fee: 30
        });
    });
});
