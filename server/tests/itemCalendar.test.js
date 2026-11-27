import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import app from "../app.js";
import {  Item } from "../models/Item.js";
import { requireAuth } from "../middleware/auth.js";
import { Reservation } from "../models/Reservation.js";


vi.mock('../models/Item.js', () => ({
     Item: { exists: vi.fn(), findOne: vi.fn() }
}));

vi.mock('../models/Reservation.js', () => ({
    Reservation: { find: vi.fn() },
    BLOCKING_STATUSES: ['active', 'upcoming']
}));


// replace only requireAuth, keep the other exports of the file
vi.mock('../middleware/auth.js', async (importOriginal) => ({
    ...(await importOriginal()),
    requireAuth: vi.fn()
}));

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


function mockQuery(result) {
    const lean = vi.fn().mockResolvedValue(result);
    Reservation.find.mockReturnValue({ lean });
    return { lean };
}

// item ids are ITM- followed by 8 lowercase hex characters
const validItemId = 'ITM-1a2b3c4d';

beforeEach(() => {
    vi.resetAllMocks();
    authenticateAs();
    Item.findOne.mockResolvedValue({ _id: validItemId, owner: { profile: { name: 'Alice' }, trustScore: 80 } });
    mockQuery([]);
});

describe('GET /api/items/:id/calendar', () => {
    it('should return 400 for invalid item id', async () => {
        const response = await request(app).get('/api/items/invalid-id/calendar');
        expect(response.status).toBe(400);
        expect(response.body.message).toBe('Invalid item id');
    });

    it('should return 404 if item does not exist', async () => {
        Item.findOne.mockResolvedValue(null);
        const response = await request(app).get(`/api/items/${validItemId}/calendar`);
        expect(response.status).toBe(404);
        expect(response.body.message).toBe('Item not found');
    });

    it('should return 404 if item owner is suspended', async () => {
        Item.findOne.mockResolvedValue({ _id: validItemId, owner: { profile: { name: 'Alice' }, trustScore: 80, suspended: true } });
        const response = await request(app).get(`/api/items/${validItemId}/calendar`);
        expect(response.status).toBe(404);
        expect(response.body.message).toBe('Item not found');
    });

    it('should return 200 and reservations for valid item id', async () => {
        const mockReservations = [
            { startDate: '2024-01-01', endDate: '2024-01-05' },
            { startDate: '2024-02-01', endDate: '2024-02-05' }
        ];
        mockQuery(mockReservations);

        const response = await request(app).get(`/api/items/${validItemId}/calendar`);
        expect(response.status).toBe(200);
        expect(response.body.reservations).toEqual(mockReservations);
    });

    it('should return 401 if not authenticated', async () => {
        rejectAuth();
        const response = await request(app).get(`/api/items/${validItemId}/calendar`);
        expect(response.status).toBe(401);
        expect(response.body.message).toBe('Authentication required');
        expect(Item.findOne).not.toHaveBeenCalled();
        expect(Reservation.find).not.toHaveBeenCalled();
    });

    it('should return 200 and empty reservations if no reservations exist', async () => {
        mockQuery([]);
        const response = await request(app).get(`/api/items/${validItemId}/calendar`);
        expect(response.status).toBe(200);
        expect(response.body.reservations).toEqual([]);
    });

    it('should ask the database for reservations sorted by startDate', async () => {
        const mockReservations = [
            { startDate: '2024-02-01', endDate: '2024-02-05' },
            { startDate: '2024-01-01', endDate: '2024-01-05' }
        ];
        mockQuery(mockReservations);
        await request(app).get(`/api/items/${validItemId}/calendar`);
        expect(Reservation.find).toHaveBeenCalledWith(
            { item: validItemId, status: { $in: ['active', 'upcoming'] } },
            { startDate: 1, endDate: 1, _id: 0 },
            { sort: { startDate: 1 } }
        );
    });

});