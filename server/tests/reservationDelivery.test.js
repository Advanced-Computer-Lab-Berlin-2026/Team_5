import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { Reservation } from '../models/Reservation.js';
import { requireAuth } from '../middleware/auth.js';
import { notifyDeliveryStatus } from '../services/notificationService.js';

vi.mock('../models/Reservation.js', () => ({
    Reservation: {
        findById: vi.fn(),
        findByIdAndUpdate: vi.fn()
    }
}));

vi.mock('../middleware/auth.js', async (importOriginal) => ({
    ...(await importOriginal()),
    requireAuth: vi.fn()
}));

vi.mock('../services/notificationService.js', () => ({
    notifyDeliveryStatus: vi.fn()
}));

const TRUSTED_ORIGIN = 'http://localhost:3000';
const reservationId = 'RES-95ced8b1';
const reservationQuery = { lean: vi.fn() };
const updateQuery = { lean: vi.fn() };

function authenticateAs(id = 'Youries', role = 'member') {
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

const getDelivery = id =>
    request(app)
        .get(`/api/reservations/${id}/delivery`)
        .set('Origin', TRUSTED_ORIGIN);

const updateDelivery = (id, status) =>
    request(app)
        .post(`/api/reservations/${id}/delivery`)
        .set('Origin', TRUSTED_ORIGIN)
        .send({ status });

beforeEach(() => {
    vi.resetAllMocks();
    authenticateAs();
    Reservation.findById.mockReturnValue(reservationQuery);
    Reservation.findByIdAndUpdate.mockReturnValue(updateQuery);
    reservationQuery.lean.mockResolvedValue({
        _id: reservationId,
        borrower: 'Youries',
        lender: 'martinies',
        delivery: { status: 'out-for-delivery', fee: 25, address: 'Martin Home' }
    });
    updateQuery.lean.mockResolvedValue({
        _id: reservationId,
        delivery: { status: 'delivered', fee: 25, address: 'Martin Home' }
    });
});

describe('GET /api/reservations/:reservationId/delivery', () => {
    it.each([
        ['member', 'Youries'],
        ['admin', 'admin123']
    ])('returns delivery data unchanged to the authorized %s', async (role, id) => {
        authenticateAs(id, role);

        const response = await getDelivery(reservationId);

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            status: 'out-for-delivery',
            fee: 25,
            address: 'Martin Home'
        });
        expect(Reservation.findById).toHaveBeenCalledExactlyOnceWith(reservationId);
    });

    it('returns 404 when the reservation has no delivery data', async () => {
        reservationQuery.lean.mockResolvedValue({
            _id: reservationId,
            borrower: 'Youries',
            lender: 'martinies'
        });

        const response = await getDelivery(reservationId);

        expect(response.status).toBe(404);
        expect(response.body).toEqual({ message: 'No delivery data' });
    });

    it('returns 400 for an invalid reservation id', async () => {
        const response = await getDelivery('invalid');

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ message: 'Invalid reservation id' });
        expect(Reservation.findById).not.toHaveBeenCalled();
    });

    it('returns 404 when the reservation does not exist', async () => {
        reservationQuery.lean.mockResolvedValue(null);

        const response = await getDelivery(reservationId);

        expect(response.status).toBe(404);
        expect(response.body).toEqual({ message: 'Reservation not found' });
    });

    it('does not expose another member reservation', async () => {
        authenticateAs('different-member');

        const response = await getDelivery(reservationId);

        expect(response.status).toBe(404);
        expect(response.body).toEqual({ message: 'Reservation not found' });
    });

    it('does not expose a reservation to another lender', async () => {
        authenticateAs('different-lender', 'lender');

        const response = await getDelivery(reservationId);

        expect(response.status).toBe(404);
        expect(response.body).toEqual({ message: 'Reservation not found' });
    });

    it('requires authentication', async () => {
        rejectAuth();

        const response = await getDelivery(reservationId);

        expect(response.status).toBe(401);
        expect(Reservation.findById).not.toHaveBeenCalled();
    });

    it('rejects users outside member, lender, and admin roles', async () => {
        authenticateAs('unknown', 'guest');

        const response = await getDelivery(reservationId);

        expect(response.status).toBe(403);
        expect(Reservation.findById).not.toHaveBeenCalled();
    });

    it('forwards database errors to the error handler', async () => {
        reservationQuery.lean.mockRejectedValue(new Error('Database unavailable'));

        const response = await getDelivery(reservationId);

        expect(response.status).toBe(500);
    });
});

describe('POST /api/reservations/:reservationId/delivery', () => {
    it('updates the status for the lender', async () => {
        authenticateAs('martinies', 'lender');

        const response = await updateDelivery(reservationId, 'delivered');

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ message: 'Updated status to delivered' });
        expect(notifyDeliveryStatus).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ _id: reservationId, borrower: 'Youries' }),
            'delivered'
        );
        expect(Reservation.findByIdAndUpdate).toHaveBeenCalledExactlyOnceWith(
            reservationId,
            { $set: { 'delivery.status': 'delivered' } },
            { new: true, runValidators: true }
        );
    });

    it('does not send a delivery notification for preparing', async () => {
        authenticateAs('martinies', 'lender');

        const response = await updateDelivery(reservationId, 'preparing');

        expect(response.status).toBe(200);
        expect(notifyDeliveryStatus).not.toHaveBeenCalled();
    });

    it('does not send a duplicate notification when the status is unchanged', async () => {
        authenticateAs('martinies', 'lender');

        const response = await updateDelivery(reservationId, 'out-for-delivery');

        expect(response.status).toBe(200);
        expect(notifyDeliveryStatus).not.toHaveBeenCalled();
    });

    it('rejects an invalid status', async () => {
        authenticateAs('martinies', 'lender');

        const response = await updateDelivery(reservationId, 'lost');

        expect(response.status).toBe(400);
        expect(Reservation.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('forbids an unrelated lender', async () => {
        authenticateAs('different-lender', 'lender');

        const response = await updateDelivery(reservationId, 'delivered');

        expect(response.status).toBe(403);
        expect(Reservation.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('returns 400 for an invalid reservation id before updating', async () => {
        authenticateAs('martinies', 'lender');

        const response = await updateDelivery('invalid', 'delivered');

        expect(response.status).toBe(400);
        expect(Reservation.findById).not.toHaveBeenCalled();
        expect(Reservation.findByIdAndUpdate).not.toHaveBeenCalled();
    });
});
