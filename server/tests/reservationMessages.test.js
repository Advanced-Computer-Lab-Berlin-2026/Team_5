import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { Reservation } from '../models/Reservation.js';
import { requireAuth } from '../middleware/auth.js';

vi.mock('../models/Reservation.js', () => ({
    Reservation: { findOne: vi.fn(), findOneAndUpdate: vi.fn() }
}));

vi.mock('../middleware/auth.js', async (importOriginal) => ({
    ...(await importOriginal()),
    requireAuth: vi.fn()
}));

const TRUSTED_ORIGIN = 'http://localhost:3000';
const reservationId = 'RES-95ced8b1';
const older = { text: 'Can I pick it up at 6?', sender: 'yara', date: '2026-11-01T10:00:00.000Z', seen: true };
const newer = { text: 'Sure', sender: 'martin', date: '2026-11-02T10:00:00.000Z', seen: false };

function authenticateAs(id = 'yara', role = 'member') {
    requireAuth.mockImplementation((req, res, next) => {
        req.user = { id, role };
        next();
    });
}

beforeEach(() => {
    vi.resetAllMocks();
    authenticateAs();
    Reservation.findOne.mockResolvedValue({
        _id: reservationId,
        status: 'upcoming',
        messages: [older, newer]
    });
    Reservation.findOneAndUpdate.mockResolvedValue({
        _id: reservationId,
        messages: [older, newer, { text: 'Thanks', sender: 'yara', date: '2026-11-03T10:00:00.000Z', seen: false }]
    });
});

describe('GET /api/reservations/:reservationId/messages', () => {
    it('lists messages oldest first for the borrower', async () => {
        const res = await request(app).get(`/api/reservations/${reservationId}/messages`);

        expect(res.status).toBe(200);
        expect(res.body.messages).toEqual([older, newer]);
        expect(Reservation.findOne).toHaveBeenCalledWith(
            { _id: reservationId, $or: [{ borrower: 'yara' }, { lender: 'yara' }] },
            { messages: 1, status: 1 },
            { lean: true }
        );
    });

    it('lists messages for the lender too', async () => {
        authenticateAs('martin', 'lender');

        const res = await request(app).get(`/api/reservations/${reservationId}/messages`);

        expect(res.status).toBe(200);
        expect(Reservation.findOne.mock.calls[0][0]).toEqual({
            _id: reservationId,
            $or: [{ borrower: 'martin' }, { lender: 'martin' }]
        });
    });

    // ?after= lets the ui poll without re-downloading the whole thread
    it('only returns messages after the given date', async () => {
        const res = await request(app).get(
            `/api/reservations/${reservationId}/messages?after=2026-11-01T12:00:00.000Z`
        );

        expect(res.status).toBe(200);
        expect(res.body.messages).toEqual([newer]);
    });

    // strict > so a poll that already has this timestamp doesn't re-fetch it
    it('excludes a message whose date equals after', async () => {
        const res = await request(app).get(
            `/api/reservations/${reservationId}/messages?after=${newer.date}`
        );

        expect(res.status).toBe(200);
        expect(res.body.messages).toEqual([]);
    });

    it.each(['after=not-a-date', 'foo=1'])('rejects ?%s with 400', async (query) => {
        const res = await request(app).get(`/api/reservations/${reservationId}/messages?${query}`);

        expect(res.status).toBe(400);
        expect(Reservation.findOne).not.toHaveBeenCalled();
    });

    it('returns an empty list when messages is missing', async () => {
        Reservation.findOne.mockResolvedValue({ _id: reservationId, status: 'active' });

        const res = await request(app).get(`/api/reservations/${reservationId}/messages`);

        expect(res.status).toBe(200);
        expect(res.body.messages).toEqual([]);
    });

    it('allows chat when the reservation is active', async () => {
        Reservation.findOne.mockResolvedValue({
            _id: reservationId,
            status: 'active',
            messages: [older]
        });

        const res = await request(app).get(`/api/reservations/${reservationId}/messages`);

        expect(res.status).toBe(200);
        expect(res.body.messages).toEqual([older]);
    });

    it('rejects an invalid reservation id with 400', async () => {
        const res = await request(app).get('/api/reservations/bad-id/messages');

        expect(res.status).toBe(400);
        expect(Reservation.findOne).not.toHaveBeenCalled();
    });

    it('404s when the reservation is missing or not theirs', async () => {
        Reservation.findOne.mockResolvedValue(null);

        const res = await request(app).get(`/api/reservations/${reservationId}/messages`);

        expect(res.status).toBe(404);
        expect(res.body).toEqual({ message: 'Reservation not found' });
    });

    it('403s when the reservation is not upcoming or active', async () => {
        Reservation.findOne.mockResolvedValue({ _id: reservationId, status: 'pending', messages: [] });

        const res = await request(app).get(`/api/reservations/${reservationId}/messages`);

        expect(res.status).toBe(403);
        expect(res.body.message).toMatch(/upcoming or active/);
    });

    it('needs a login', async () => {
        requireAuth.mockImplementation((req, res) => res.status(401).json({ message: 'Authentication required' }));

        const res = await request(app).get(`/api/reservations/${reservationId}/messages`);

        expect(res.status).toBe(401);
        expect(Reservation.findOne).not.toHaveBeenCalled();
    });

    it('passes a database error on as a 500', async () => {
        Reservation.findOne.mockRejectedValue(new Error('db down'));

        const res = await request(app).get(`/api/reservations/${reservationId}/messages`);

        expect(res.status).toBe(500);
    });
});

describe('POST /api/reservations/:reservationId/messages', () => {
    const post = (body) =>
        request(app)
            .post(`/api/reservations/${reservationId}/messages`)
            .set('Origin', TRUSTED_ORIGIN)
            .send(body);

    it('pushes the message and returns it', async () => {
        const res = await post({ text: 'Thanks' });

        expect(res.status).toBe(201);
        expect(res.body.message).toMatchObject({ text: 'Thanks', sender: 'yara' });
        expect(Reservation.findOneAndUpdate).toHaveBeenCalledWith(
            {
                _id: reservationId,
                $or: [{ borrower: 'yara' }, { lender: 'yara' }],
                status: { $in: ['upcoming', 'active'] }
            },
            { $push: { messages: { text: 'Thanks', sender: 'yara' } } },
            { returnDocument: 'after', lean: true, projection: { messages: 1 } }
        );
    });

    it('still sends when the reservation is active', async () => {
        const res = await post({ text: 'On my way' });

        expect(res.status).toBe(201);
        expect(Reservation.findOneAndUpdate.mock.calls[0][0].status).toEqual({
            $in: ['upcoming', 'active']
        });
    });

    it('trims the text before saving', async () => {
        await post({ text: '  Thanks  ' });

        expect(Reservation.findOneAndUpdate.mock.calls[0][1]).toEqual({
            $push: { messages: { text: 'Thanks', sender: 'yara' } }
        });
    });

    it.each([
        ['empty', { text: '' }],
        ['whitespace', { text: '   ' }],
        ['too long', { text: 'x'.repeat(1001) }],
        ['missing', {}]
    ])('rejects %s text with 400', async (label, body) => {
        const res = await post(body);

        expect(res.status).toBe(400);
        expect(Reservation.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('rejects an invalid reservation id with 400', async () => {
        const res = await request(app)
            .post('/api/reservations/bad-id/messages')
            .set('Origin', TRUSTED_ORIGIN)
            .send({ text: 'Hi' });

        expect(res.status).toBe(400);
        expect(Reservation.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('404s when the reservation is missing or not theirs', async () => {
        Reservation.findOneAndUpdate.mockResolvedValue(null);
        Reservation.findOne.mockResolvedValue(null);

        const res = await post({ text: 'Hi' });

        expect(res.status).toBe(404);
    });

    // update filter includes status, so a finished booking comes back null then we look up why
    it('403s when the reservation is not upcoming or active', async () => {
        Reservation.findOneAndUpdate.mockResolvedValue(null);
        Reservation.findOne.mockResolvedValue({ _id: reservationId, status: 'completed' });

        const res = await post({ text: 'Hi' });

        expect(res.status).toBe(403);
        expect(res.body.message).toMatch(/upcoming or active/);
    });

    it('needs a login', async () => {
        requireAuth.mockImplementation((req, res) => res.status(401).json({ message: 'Authentication required' }));

        const res = await post({ text: 'Hi' });

        expect(res.status).toBe(401);
        expect(Reservation.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('passes a database error on as a 500', async () => {
        Reservation.findOneAndUpdate.mockRejectedValue(new Error('db down'));

        const res = await post({ text: 'Hi' });

        expect(res.status).toBe(500);
    });
});
