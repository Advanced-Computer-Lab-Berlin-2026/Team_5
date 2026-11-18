import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { Item, User } from '../models/index.js';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { notifyWishlistItemAvailable, notifyWaitlistItemAvailable } from '../services/notificationService.js';

vi.mock('../models/User.js', () => ({
    User: { findById: vi.fn() }
}));

vi.mock('../services/notificationService.js', () => ({
    notifyWishlistItemAvailable: vi.fn(),
    notifyWaitlistItemAvailable: vi.fn(),
}));

beforeEach(() => {
    vi.resetAllMocks();
    notifyWishlistItemAvailable.mockResolvedValue(undefined);
    notifyWaitlistItemAvailable.mockResolvedValue(undefined);
});

describe('PATCH /api/lender/items/:id/archive', () => {
    it('no cookie should return 401', async () => {
        const response = await request(app).patch('/api/lender/items/itemId/archive').set('Origin', 'http://localhost:3000');
        expect(response.status).toBe(401);
    });

    it('requesting with a member cookie should return a 403', async () => {
        User.findById.mockResolvedValue({ id: 'member1', role: 'member' });
        const memberToken = jwt.sign({ id: 'member1', role: 'member' }, env.jwtSecret, { expiresIn: '15m' });
        const response = await request(app).patch('/api/lender/items/itemId/archive').set('Origin', 'http://localhost:3000').set('Cookie', `accessToken=${memberToken}`);
        expect(response.status).toBe(403);
    });

    it('item does not exist should return 404', async () => {
        User.findById.mockResolvedValue({ id: 'lender1', role: 'lender' });
        const lenderToken = jwt.sign({ id: 'lender1', role: 'lender' }, env.jwtSecret, { expiresIn: '15m' });
        vi.spyOn(Item, 'findById').mockResolvedValue(null);
        const response = await request(app).patch('/api/lender/items/itemId/archive').set('Origin', 'http://localhost:3000').set('Cookie', `accessToken=${lenderToken}`);
        expect(response.status).toBe(404);
    });

    it('item exists but belongs to another lender should return 403', async () => {
        User.findById.mockResolvedValue({ id: 'lender1', role: 'lender' });
        const lenderToken = jwt.sign({ id: 'lender1', role: 'lender' }, env.jwtSecret, { expiresIn: '15m' });
        const mockItem = { _id: 'itemId', owner: 'lender2', archived: false };
        vi.spyOn(Item, 'findById').mockResolvedValue(mockItem);
        const update = vi.spyOn(Item, 'findOneAndUpdate');
        const response = await request(app).patch('/api/lender/items/itemId/archive').set('Origin', 'http://localhost:3000').set('Cookie', `accessToken=${lenderToken}`);
        expect(update).not.toHaveBeenCalled();
        expect(response.body.message).toBe('You do not have permission to archive this item')
        expect(response.status).toBe(403);
    });

    it('item exists and belongs to lender should toggle archived status and return 200', async () => {
        User.findById.mockResolvedValue({ id: 'lender1', role: 'lender' });
        const lenderToken = jwt.sign({ id: 'lender1', role: 'lender' }, env.jwtSecret, { expiresIn: '15m' });
        const mockItem = { _id: 'itemId', owner: 'lender1', archived: false };
        vi.spyOn(Item, 'findById').mockResolvedValue(mockItem);
        vi.spyOn(Item, 'findOneAndUpdate').mockResolvedValue({ ...mockItem, archived: true });
        const response = await request(app).patch('/api/lender/items/itemId/archive').set('Origin', 'http://localhost:3000').set('Cookie', `accessToken=${lenderToken}`);
        expect(response.status).toBe(200);
        expect(response.body.item.archived).toBe(true);
        expect(Item.findOneAndUpdate).toHaveBeenCalledWith(
            { _id: 'itemId', owner: 'lender1', archived: false },
            { $set: { archived: true } },
            { new: true }
        );
        expect(notifyWishlistItemAvailable).not.toHaveBeenCalled();
        expect(notifyWaitlistItemAvailable).not.toHaveBeenCalled();
    });

    it('item exists and belongs to lender should toggle archived status back to false and return 200', async () => {
        User.findById.mockResolvedValue({ id: 'lender1', role: 'lender' });
        const lenderToken = jwt.sign({ id: 'lender1', role: 'lender' }, env.jwtSecret, { expiresIn: '15m' });
        const mockItem = { _id: 'itemId', owner: 'lender1', archived: true };
        vi.spyOn(Item, 'findById').mockResolvedValue(mockItem);
        vi.spyOn(Item, 'findOneAndUpdate').mockResolvedValue({ ...mockItem, archived: false });
        const response = await request(app).patch('/api/lender/items/itemId/archive').set('Origin', 'http://localhost:3000').set('Cookie', `accessToken=${lenderToken}`);
        expect(response.status).toBe(200);
        expect(response.body.item.archived).toBe(false);
        expect(notifyWishlistItemAvailable).toHaveBeenCalledWith('itemId');
        expect(notifyWaitlistItemAvailable).toHaveBeenCalledWith('itemId');
    });

    it('should handle errors and return a 500 status', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {}); // Suppress error logging in test output
        User.findById.mockResolvedValue({ id: 'lender1', role: 'lender' });
        const lenderToken = jwt.sign({ id: 'lender1', role: 'lender' }, env.jwtSecret, { expiresIn: '15m' });
        vi.spyOn(Item, 'findById').mockImplementation(() => { throw new Error('Database Error') });
        const response = await request(app).patch('/api/lender/items/itemId/archive').set('Origin', 'http://localhost:3000').set('Cookie', `accessToken=${lenderToken}`);
        expect(response.status).toBe(500);
        expect(response.body.message).toBe('Server Error');
    });

});