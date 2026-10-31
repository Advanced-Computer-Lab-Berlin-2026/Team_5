import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { User, Item } from '../models/index.js';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

vi.mock('../models/User.js', () => ({
    User: { findById: vi.fn() }
}));

beforeEach(() => {
    vi.resetAllMocks();
});

describe('GET /api/lender/items', () => {

    it('requesting without a cookie should return a 401', async () => {
        const response = await request(app).get('/api/lender/items').set('Origin', 'http://localhost:3000');
        expect(response.status).toBe(401);
    });

    it('requesting with a member cookie should return a 403', async () => {
        User.findById.mockResolvedValue({ id: 'member1', role: 'member' });
        const memberToken = jwt.sign({ id: 'member1', role: 'member' }, env.jwtSecret, { expiresIn: '15m' });
        const response = await request(app).get('/api/lender/items').set('Origin', 'http://localhost:3000').set('Cookie', `accessToken=${memberToken}`);
        expect(response.status).toBe(403);
    });

    it('requesting with a lender cookie should return a 200 and an array of items', async () => {
        User.findById.mockResolvedValue({ id: 'lender1', role: 'lender' });
        const lenderToken = jwt.sign({ id: 'lender1', role: 'lender' }, env.jwtSecret, { expiresIn: '15m' });
        const mockItems = [
            { _id: 'item1', name: 'Item 1', owner: 'lender1' },
            { _id: 'item2', name: 'Item 2', owner: 'lender1' }
        ];
        vi.spyOn(Item, 'find').mockImplementation(() => ({ sort: () => mockItems
        }));
        const response = await request(app).get('/api/lender/items').set('Origin', 'http://localhost:3000').set('Cookie', `accessToken=${lenderToken}`);
        expect(response.body.items).toEqual(mockItems);
        expect(Item.find).toHaveBeenCalledWith({ owner: 'lender1' });
        expect(response.status).toBe(200);
    });

    it('a lender with no items should return a 200 and an empty array', async () => {
        User.findById.mockResolvedValue({ id: 'lender2', role: 'lender' });
        const lenderToken = jwt.sign({ id: 'lender2', role: 'lender' }, env.jwtSecret, { expiresIn: '15m' });
        vi.spyOn(Item, 'find').mockImplementation(() => ({ sort: () => [] }));
        const response = await request(app).get('/api/lender/items').set('Origin', 'http://localhost:3000').set('Cookie', `accessToken=${lenderToken}`);
        expect(response.body.items).toEqual([]);
        expect(Item.find).toHaveBeenCalledWith({ owner: 'lender2' });
        expect(response.status).toBe(200);
    });

    it('should handle errors and return a 500 status', async () => {
        User.findById.mockResolvedValue({ id: 'lender1', role: 'lender' });
        vi.spyOn(console, 'error').mockImplementation(() => {}); // Suppress error logging in test output
        const lenderToken = jwt.sign({ id: 'lender1', role: 'lender' }, env.jwtSecret, { expiresIn: '15m' });
        vi.spyOn(Item, 'find').mockImplementation(() => { throw new Error('Database Error') });
        const response = await request(app).get('/api/lender/items').set('Origin', 'http://localhost:3000').set('Cookie', `accessToken=${lenderToken}`);
        expect(response.status).toBe(500);
        expect(response.body.message).toBe('Server Error');
    }); 
});
