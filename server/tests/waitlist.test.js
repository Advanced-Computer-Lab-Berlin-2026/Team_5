import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { Item } from '../models/Item.js';
import { Reservation } from '../models/Reservation.js';
import { Waitlist } from '../models/Waitlist.js';
import { requireAuth } from '../middleware/auth.js';

vi.mock('../models/Item.js', () => ({
    Item: { findById: vi.fn() }
}));

vi.mock('../models/Waitlist.js', () => ({
    Waitlist: { create: vi.fn(), deleteOne: vi.fn(), find: vi.fn() }
}));

vi.mock('../models/Reservation.js', () => ({
    Reservation: { findOverlap: vi.fn() }
}));

vi.mock('../middleware/auth.js', async (importOriginal) => ({
    ...(await importOriginal()),
    requireAuth: vi.fn()
}));

const TRUSTED_ORIGIN = 'http://localhost:3000';
const itemId = 'ITM-1a2b3c4d';
const startDate = '2026-12-01T00:00:00.000Z';
const endDate = '2026-12-05T00:00:00.000Z';
const body = { startDate, endDate };

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

const join = (id = itemId, data = body) =>
    request(app).post(`/api/waitlist/${id}`).set('Origin', TRUSTED_ORIGIN).send(data);
const leave = (id = itemId, data = body) =>
    request(app).delete(`/api/waitlist/${id}`).set('Origin', TRUSTED_ORIGIN).send(data);
const listWaitlist = () =>
    request(app).get('/api/waitlist').set('Origin', TRUSTED_ORIGIN);

beforeEach(() => {
    vi.resetAllMocks();
    authenticateAs();
    Item.findById.mockResolvedValue({ _id: itemId, archived: false });
    Reservation.findOverlap.mockResolvedValue({ _id: 'RES-12345678' });
    Waitlist.create.mockResolvedValue({ _id: 'WTL-12345678' });
    Waitlist.deleteOne.mockResolvedValue({ deletedCount: 1 });
    Waitlist.find.mockReturnValue({
        populate: vi.fn().mockResolvedValue([])
    });
});

describe('POST /api/waitlist/:itemId', () => {
    it.each(['member', 'admin', 'lender'])('lets a %s join the waitlist', async (role) => {
        authenticateAs('user123', role);

        const response = await join();

        expect(response.status).toBe(201);
        expect(response.body).toEqual({ message: 'Joined the waitlist' });
        expect(Reservation.findOverlap).toHaveBeenCalledExactlyOnceWith(
            itemId,
            new Date(startDate),
            new Date(endDate)
        );
        expect(Waitlist.create).toHaveBeenCalledExactlyOnceWith({
            item: itemId,
            startDate: new Date(startDate),
            endDate: new Date(endDate),
            username: 'user123'
        });
    });

    it('returns 401 when the request is not authenticated', async () => {
        rejectAuth();

        const response = await join();

        expect(response.status).toBe(401);
        expect(Item.findById).not.toHaveBeenCalled();
        expect(Reservation.findOverlap).not.toHaveBeenCalled();
    });

    it('returns 403 for a role outside member, admin, and lender', async () => {
        authenticateAs('user123', 'guest');

        const response = await join();

        expect(response.status).toBe(403);
        expect(Item.findById).not.toHaveBeenCalled();
        expect(Reservation.findOverlap).not.toHaveBeenCalled();
    });

    it('returns 400 for an invalid item id', async () => {
        const response = await join('invalid-id');

        expect(response.status).toBe(400);
        expect(response.body.message).toBe('Invalid item id');
        expect(Item.findById).not.toHaveBeenCalled();
        expect(Reservation.findOverlap).not.toHaveBeenCalled();
    });

    it.each([
        [{ endDate }, 'startDate'],
        [{ startDate, endDate: 'invalid-date' }, 'endDate'],
        [{ startDate, endDate: startDate }, 'endDate'],
        [{ startDate: endDate, endDate: startDate }, 'endDate']
    ])('returns 400 when the requested dates are invalid', async (data, field) => {
        const response = await join(itemId, data);

        expect(response.status).toBe(400);
        expect(response.body.message).toContain(field);
        expect(Item.findById).not.toHaveBeenCalled();
        expect(Reservation.findOverlap).not.toHaveBeenCalled();
    });

    it('returns 404 when the item does not exist', async () => {
        Item.findById.mockResolvedValue(null);

        const response = await join();

        expect(response.status).toBe(404);
        expect(response.body.message).toBe('Item not found');
        expect(Reservation.findOverlap).not.toHaveBeenCalled();
        expect(Waitlist.create).not.toHaveBeenCalled();
    });

    it('allows joining when the item is not archived but has an overlapping reservation', async () => {
        Item.findById.mockResolvedValue({ _id: itemId, archived: false });

        const response = await join();

        expect(response.status).toBe(201);
        expect(response.body.message).toBe('Joined the waitlist');
    });

    it('returns an error and message when no reservation overlaps the requested dates', async () => {
        Reservation.findOverlap.mockResolvedValue(null);

        const response = await join();

        expect(response.status).toBe(409);
        expect(response.body).toEqual({
            error: 'ITEM_NOT_FULLY_BOOKED',
            message: 'Cannot join the waitlist: no active reservation overlaps these dates'
        });
        expect(Waitlist.create).not.toHaveBeenCalled();
    });

    it('returns 409 when the user has already joined that waitlist', async () => {
        Waitlist.create.mockRejectedValue({ code: 11000 });

        const response = await join();

        expect(response.status).toBe(409);
        expect(response.body.message).toContain('already joined');
    });

    it.each([
        ['item lookup', () => Item.findById.mockRejectedValue(new Error('Database unavailable'))],
        ['reservation lookup', () => Reservation.findOverlap.mockRejectedValue(new Error('Database unavailable'))],
        ['waitlist creation', () => Waitlist.create.mockRejectedValue(new Error('Database unavailable'))]
    ])('forwards %s errors to the error handler', async (_, fail) => {
        fail();

        const response = await join();

        expect(response.status).toBe(500);
    });
});

describe('DELETE /api/waitlist/:itemId', () => {
    it.each(['member', 'admin', 'lender'])('lets a %s leave the waitlist', async (role) => {
        authenticateAs('user123', role);
        Waitlist.deleteOne.mockResolvedValue({ deletedCount: 1 });

        const response = await leave();

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ message: 'Left the waitlist' });
        expect(Waitlist.deleteOne).toHaveBeenCalledExactlyOnceWith(
            {
                item: itemId,
                startDate: new Date(startDate),
                endDate: new Date(endDate),
                username: 'user123'
            }
        );
    });

    it('returns 401 when the request is not authenticated', async () => {
        rejectAuth();

        const response = await leave();

        expect(response.status).toBe(401);
        expect(Waitlist.deleteOne).not.toHaveBeenCalled();
    });

    it('returns 403 for a role outside member, admin, and lender', async () => {
        authenticateAs('user123', 'guest');

        const response = await leave();

        expect(response.status).toBe(403);
        expect(Waitlist.deleteOne).not.toHaveBeenCalled();
    });

    it('returns 400 for an invalid item id', async () => {
        const response = await leave('invalid-id');

        expect(response.status).toBe(400);
        expect(response.body.message).toBe('Invalid item id');
        expect(Waitlist.deleteOne).not.toHaveBeenCalled();
    });

    it.each([
        [{ endDate }, 'startDate'],
        [{ startDate, endDate: 'invalid-date' }, 'endDate'],
        [{ startDate, endDate: startDate }, 'endDate'],
        [{ startDate: endDate, endDate: startDate }, 'endDate']
    ])('returns 400 when the requested dates are invalid', async (data, field) => {
        const response = await leave(itemId, data);

        expect(response.status).toBe(400);
        expect(response.body.message).toContain(field);
        expect(Waitlist.deleteOne).not.toHaveBeenCalled();
    });

    it('returns 404 when the user is not on the waitlist', async () => {
        Waitlist.deleteOne.mockResolvedValue({ deletedCount: 0 });

        const response = await leave();

        expect(response.status).toBe(404);
        expect(response.body.message).toBe('You are not on this waitlist');
    });

    it('forwards waitlist update errors to the error handler', async () => {
        Waitlist.deleteOne.mockRejectedValue(new Error('Database unavailable'));

        const response = await leave();

        expect(response.status).toBe(500);
    });
});

describe('GET /api/waitlist', () => {
    it.each(['member', 'admin', 'lender'])('returns the %s user’s waitlist entries', async (role) => {
        authenticateAs('user123', role);
        const waitlists = [{ _id: 'WTL-12345678', item: { _id: itemId, name: 'Drill' } }];
        const populate = vi.fn().mockResolvedValue(waitlists);
        Waitlist.find.mockReturnValue({ populate });

        const response = await listWaitlist();

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ waitlists });
        expect(Waitlist.find).toHaveBeenCalledExactlyOnceWith({ username: 'user123' });
        expect(populate).toHaveBeenCalledExactlyOnceWith('item');
    });

    it('returns an empty list when the user has not joined any waitlists', async () => {
        const response = await listWaitlist();

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ waitlists: [] });
    });

    it('returns 401 when the request is not authenticated', async () => {
        rejectAuth();

        const response = await listWaitlist();

        expect(response.status).toBe(401);
        expect(Waitlist.find).not.toHaveBeenCalled();
    });

    it('returns 403 for a role outside member, admin, and lender', async () => {
        authenticateAs('user123', 'guest');

        const response = await listWaitlist();

        expect(response.status).toBe(403);
        expect(Waitlist.find).not.toHaveBeenCalled();
    });

    it('forwards waitlist lookup errors to the error handler', async () => {
        Waitlist.find.mockReturnValue({
            populate: vi.fn().mockRejectedValue(new Error('Database unavailable'))
        });

        const response = await listWaitlist();

        expect(response.status).toBe(500);
    });
});
