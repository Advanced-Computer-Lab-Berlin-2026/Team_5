import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../app.js';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { Reservation } from '../models/Reservation.js';
import { Payment } from '../models/Payment.js';
import { Notification } from '../models/Notification.js';

vi.mock('../models/User.js', () => ({
    User: { findById: vi.fn(), updateOne: vi.fn() }
}));

const ORIGIN = 'http://localhost:3000';
const token = (id, role) => jwt.sign({ id, role }, env.jwtSecret, { expiresIn: '15m' });
const asLender = () => {
    User.findById.mockResolvedValue({ id: 'lender1', role: 'lender' });
    return `accessToken=${token('lender1', 'lender')}`;
};
const mockReservation = (overrides = {}) => ({
    _id: 'RES-1', lender: 'lender1', borrower: 'borrower1', status: 'upcoming',
    payment: { depositAmount: 100, method: 'wallet' }, save: vi.fn(), ...overrides,
});

beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
});

describe('PATCH /api/lender/reservations/:id/pickup', () => {
    const url = '/api/lender/reservations/RES-1/pickup';

    it('401 without cookie', async () => {
        const res = await request(app).patch(url).set('Origin', ORIGIN);
        expect(res.status).toBe(401);
    });

    it('403 for a member', async () => {
        User.findById.mockResolvedValue({ id: 'm1', role: 'member' });
        const res = await request(app).patch(url).set('Origin', ORIGIN).set('Cookie', `accessToken=${token('m1', 'member')}`);
        expect(res.status).toBe(403);
    });

    it('404 when reservation missing', async () => {
        const cookie = asLender();
        vi.spyOn(Reservation, 'findById').mockResolvedValue(null);
        const res = await request(app).patch(url).set('Origin', ORIGIN).set('Cookie', cookie);
        expect(res.status).toBe(404);
    });

    it('403 when reservation belongs to another lender', async () => {
        const cookie = asLender();
        const r = mockReservation({ lender: 'lender2' });
        vi.spyOn(Reservation, 'findById').mockResolvedValue(r);
        const res = await request(app).patch(url).set('Origin', ORIGIN).set('Cookie', cookie);
        expect(res.status).toBe(403);
        expect(r.save).not.toHaveBeenCalled();
    });

    it('409 when not upcoming', async () => {
        const cookie = asLender();
        vi.spyOn(Reservation, 'findById').mockResolvedValue(mockReservation({ status: 'pending' }));
        const res = await request(app).patch(url).set('Origin', ORIGIN).set('Cookie', cookie);
        expect(res.status).toBe(409);
    });

    it('200 sets status active and notifies borrower', async () => {
        const cookie = asLender();
        const r = mockReservation();
        vi.spyOn(Reservation, 'findById').mockResolvedValue(r);
        const notify = vi.spyOn(Notification, 'create').mockResolvedValue({});
        const res = await request(app).patch(url).set('Origin', ORIGIN).set('Cookie', cookie);
        expect(res.status).toBe(200);
        expect(res.body.reservation.status).toBe('active');
        expect(r.handover.pickedUpAt).toBeInstanceOf(Date);
        expect(r.save).toHaveBeenCalled();
        expect(notify).toHaveBeenCalledWith(expect.objectContaining({ username: 'borrower1' }));
    });
});

describe('PATCH /api/lender/reservations/:id/return', () => {
    const url = '/api/lender/reservations/RES-1/return';
    const session = { withTransaction: vi.fn(), endSession: vi.fn() };

    const setupSession = () => {
        session.withTransaction.mockImplementation(async (fn) => fn());
        vi.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    };

    it('409 when not active', async () => {
        const cookie = asLender();
        vi.spyOn(Reservation, 'findById').mockResolvedValue(mockReservation({ status: 'upcoming' }));
        const res = await request(app).patch(url).set('Origin', ORIGIN).set('Cookie', cookie);
        expect(res.status).toBe(409);
    });

    it('403 when reservation belongs to another lender', async () => {
        const cookie = asLender();
        vi.spyOn(Reservation, 'findById').mockResolvedValue(mockReservation({ status: 'active', lender: 'lender2' }));
        const start = vi.spyOn(mongoose, 'startSession');
        const res = await request(app).patch(url).set('Origin', ORIGIN).set('Cookie', cookie);
        expect(res.status).toBe(403);
        expect(start).not.toHaveBeenCalled();
    });

    it('200 completes reservation and refunds deposit to wallet', async () => {
        const cookie = asLender();
        setupSession();
        vi.spyOn(Reservation, 'findById').mockResolvedValue(mockReservation({ status: 'active' }));
        vi.spyOn(Reservation, 'findOneAndUpdate').mockResolvedValue({ _id: 'RES-1', status: 'completed', handover: { returnedAt: new Date(), returnCondition: 'good' } });
        User.updateOne.mockResolvedValue({});
        const pay = vi.spyOn(Payment, 'create').mockResolvedValue([{}]);
        vi.spyOn(Notification, 'create').mockResolvedValue([{}]);

        const res = await request(app).patch(url).set('Origin', ORIGIN).set('Cookie', cookie);

        expect(res.status).toBe(200);
        expect(res.body.reservation.status).toBe('completed');
        expect(res.body.reservation.handover.returnCondition).toBe('good');
        expect(res.body.refunded).toBe(100);
        expect(User.updateOne).toHaveBeenCalledWith({ _id: 'borrower1' }, { $inc: { wallet: 100 } }, { session });
        expect(pay).toHaveBeenCalledWith([expect.objectContaining({ type: 'deposit-refund', amount: 100, direction: 'receive' })], { session });
        expect(session.endSession).toHaveBeenCalled();
    });

    it('409 and no refund if already completed by a parallel request', async () => {
        const cookie = asLender();
        setupSession();
        vi.spyOn(Reservation, 'findById').mockResolvedValue(mockReservation({ status: 'active' }));
        vi.spyOn(Reservation, 'findOneAndUpdate').mockResolvedValue(null);
        const res = await request(app).patch(url).set('Origin', ORIGIN).set('Cookie', cookie);
        expect(res.status).toBe(409);
        expect(User.updateOne).not.toHaveBeenCalled();
    });

    it('500 when the transaction fails', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const cookie = asLender();
        session.withTransaction.mockRejectedValue(new Error('db down'));
        vi.spyOn(mongoose, 'startSession').mockResolvedValue(session);
        vi.spyOn(Reservation, 'findById').mockResolvedValue(mockReservation({ status: 'active' }));
        const res = await request(app).patch(url).set('Origin', ORIGIN).set('Cookie', cookie);
        expect(res.status).toBe(500);
        expect(res.body.message).toBe('Server Error');
        expect(session.endSession).toHaveBeenCalled();
    });
});
