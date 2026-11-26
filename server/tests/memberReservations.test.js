import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../app.js';
import { Reservation } from '../models/Reservation.js';
import { Item } from '../models/Item.js';
import { User } from '../models/User.js';
import { Payment } from '../models/Payment.js';
import { Notification } from '../models/Notification.js';
import { requireAuth } from '../middleware/auth.js';

vi.mock('../middleware/auth.js', async (importOriginal) => ({
    ...(await importOriginal()),
    requireAuth: vi.fn()
}));

const ORIGIN = 'http://localhost:3000';
const validResId = 'RES-12345678';
const validItemId = 'ITM-12345678';

function authenticateAs(id = 'member1', role = 'member') {
    requireAuth.mockImplementation((req, res, next) => {
        req.user = { id, role };
        next();
    });
}

function mockFindReservations(list) {
    const lean = vi.fn().mockResolvedValue(list);
    const populate = vi.fn().mockReturnValue({ lean });
    const sort = vi.fn().mockReturnValue({ populate });
    vi.spyOn(Reservation, 'find').mockReturnValue({ sort });
    return { sort, populate, lean };
}

beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    authenticateAs();
});

describe('GET /api/reservations', () => {
    it('returns 200 with all reservations for the logged-in member', async () => {
        const sample = [{ _id: validResId, borrower: 'member1', status: 'upcoming' }];
        mockFindReservations(sample);

        const res = await request(app).get('/api/reservations').set('Origin', ORIGIN);

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ reservations: sample });
        expect(Reservation.find).toHaveBeenCalledWith({ borrower: 'member1' });
    });

    it('filters by status when status query param is provided', async () => {
        mockFindReservations([]);

        const res = await request(app)
            .get('/api/reservations')
            .query({ status: 'completed' })
            .set('Origin', ORIGIN);

        expect(res.status).toBe(200);
        expect(Reservation.find).toHaveBeenCalledWith({
            borrower: 'member1',
            status: 'completed'
        });
    });

    it('filters by view=upcoming and view=past', async () => {
        mockFindReservations([]);

        await request(app).get('/api/reservations').query({ view: 'upcoming' }).set('Origin', ORIGIN);
        expect(Reservation.find).toHaveBeenCalledWith({
            borrower: 'member1',
            status: { $in: ['pending', 'upcoming', 'active'] }
        });

        await request(app).get('/api/reservations').query({ view: 'past' }).set('Origin', ORIGIN);
        expect(Reservation.find).toHaveBeenCalledWith({
            borrower: 'member1',
            status: { $in: ['completed', 'cancelled', 'rejected'] }
        });
    });

    it('filters by date range (from and to)', async () => {
        mockFindReservations([]);

        const res = await request(app)
            .get('/api/reservations')
            .query({ from: '2026-12-01T00:00:00.000Z', to: '2026-12-10T00:00:00.000Z' })
            .set('Origin', ORIGIN);

        expect(res.status).toBe(200);
        expect(Reservation.find).toHaveBeenCalledWith({
            borrower: 'member1',
            endDate: { $gte: new Date('2026-12-01T00:00:00.000Z') },
            startDate: { $lte: new Date('2026-12-10T00:00:00.000Z') }
        });
    });

    it.each([
        ['from', 'endDate', '$gte'],
        ['to', 'startDate', '$lte']
    ])('filters by %s alone', async (parameter, field, operator) => {
        mockFindReservations([]);
        const date = '2026-12-05T00:00:00.000Z';

        const res = await request(app)
            .get('/api/reservations')
            .query({ [parameter]: date })
            .set('Origin', ORIGIN);

        expect(res.status).toBe(200);
        expect(Reservation.find).toHaveBeenCalledWith({
            borrower: 'member1',
            [field]: { [operator]: new Date(date) }
        });
    });

    it.each([
        { status: 'invalid-status' },
        { from: '2026-12-10', to: '2026-12-01' },
        { to: 'invalid-date' }
    ])('returns 400 for invalid filters: %j', async (query) => {
        const res = await request(app)
            .get('/api/reservations')
            .query(query)
            .set('Origin', ORIGIN);

        expect(res.status).toBe(400);
    });
});

describe('PATCH /api/reservations/:reservationId/cancel', () => {
    const session = { withTransaction: vi.fn(), endSession: vi.fn() };
    const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);

    beforeEach(() => {
        session.withTransaction.mockImplementation(async (fn) => fn());
        vi.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    });

    it('returns 400 for an invalid reservation id', async () => {
        const res = await request(app)
            .patch('/api/reservations/bad-id/cancel')
            .set('Origin', ORIGIN);

        expect(res.status).toBe(400);
    });

    it('returns 404 when reservation does not exist', async () => {
        vi.spyOn(Reservation, 'findById').mockResolvedValue(null);

        const res = await request(app)
            .patch(`/api/reservations/${validResId}/cancel`)
            .set('Origin', ORIGIN);

        expect(res.status).toBe(404);
    });

    it('returns 403 when reservation belongs to another borrower', async () => {
        vi.spyOn(Reservation, 'findById').mockResolvedValue({
            _id: validResId,
            borrower: 'someoneElse',
            status: 'upcoming',
            startDate: futureDate
        });

        const res = await request(app)
            .patch(`/api/reservations/${validResId}/cancel`)
            .set('Origin', ORIGIN);

        expect(res.status).toBe(403);
    });

    it('returns 409 when reservation is already active or completed', async () => {
        vi.spyOn(Reservation, 'findById').mockResolvedValue({
            _id: validResId,
            borrower: 'member1',
            status: 'active',
            startDate: futureDate
        });

        const res = await request(app)
            .patch(`/api/reservations/${validResId}/cancel`)
            .set('Origin', ORIGIN);

        expect(res.status).toBe(409);
    });

    it('returns 409 when pickup date has already arrived', async () => {
        vi.spyOn(Reservation, 'findById').mockResolvedValue({
            _id: validResId,
            borrower: 'member1',
            status: 'upcoming',
            startDate: new Date(Date.now() - 1000)
        });

        const res = await request(app)
            .patch(`/api/reservations/${validResId}/cancel`)
            .set('Origin', ORIGIN);

        expect(res.status).toBe(409);
    });

    it('returns 200, cancels reservation, refunds deposit to wallet, and notifies lender', async () => {
        vi.spyOn(Reservation, 'findById').mockResolvedValue({
            _id: validResId,
            item: validItemId,
            borrower: 'member1',
            lender: 'lender1',
            status: 'upcoming',
            startDate: futureDate,
            payment: { depositAmount: 80, method: 'wallet' }
        });
        vi.spyOn(Item, 'findById').mockReturnValue({
            lean: vi.fn().mockResolvedValue({ _id: validItemId, cancellation: { freeDays: 0, forfeitPercent: 0 } })
        });
        vi.spyOn(Reservation, 'findOneAndUpdate').mockResolvedValue({
            _id: validResId,
            status: 'cancelled'
        });
        const updateUser = vi.spyOn(User, 'updateOne').mockResolvedValue({});
        const createPayment = vi.spyOn(Payment, 'create').mockResolvedValue([{}]);
        const createNotification = vi.spyOn(Notification, 'create').mockResolvedValue([{}]);

        const res = await request(app)
            .patch(`/api/reservations/${validResId}/cancel`)
            .set('Origin', ORIGIN);

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            reservation: { _id: validResId, status: 'cancelled' },
            refunded: 80
        });
        expect(updateUser).toHaveBeenCalledWith({ _id: 'member1' }, { $inc: { wallet: 80 } }, { session });
        expect(createPayment).toHaveBeenCalledOnce();
        expect(createNotification).toHaveBeenCalledOnce();
    });
});

describe('DELETE /api/borrow-list/:itemId', () => {
    it('returns 400 for an invalid item id', async () => {
        const res = await request(app)
            .delete('/api/borrow-list/bad-id')
            .set('Origin', ORIGIN);

        expect(res.status).toBe(400);
    });

    it('returns 404 when the item is not in the borrow list', async () => {
        vi.spyOn(User, 'updateOne').mockResolvedValue({ matchedCount: 1, modifiedCount: 0 });

        const res = await request(app)
            .delete(`/api/borrow-list/${validItemId}`)
            .set('Origin', ORIGIN);

        expect(res.status).toBe(404);
    });

    it('returns 200 and removes the item from borrow_list', async () => {
        vi.spyOn(User, 'updateOne').mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
        const populate = vi.fn().mockResolvedValue({ borrow_list: [] });
        const select = vi.fn().mockReturnValue({ populate });
        vi.spyOn(User, 'findById').mockReturnValue({ select });

        const res = await request(app)
            .delete(`/api/borrow-list/${validItemId}`)
            .set('Origin', ORIGIN);

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            message: 'Item removed from borrow list',
            borrowList: []
        });
        expect(User.updateOne).toHaveBeenCalledWith(
            { _id: 'member1' },
            { $pull: { borrow_list: { item: validItemId } } }
        );
    });
});
