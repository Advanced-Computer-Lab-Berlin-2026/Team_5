import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { Item, User, Category } from '../models/index.js';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

vi.mock('../models/User.js', () => ({
    User: { findById: vi.fn() }
}));

vi.mock('../models/Category.js', () => ({
    Category: { findById: vi.fn() }
}));

beforeEach(() => {
    vi.resetAllMocks();
});

describe('PATCH /api/lender/items/:id', () => {
    it('no cookie should return 401', async () => {
        const response = await request(app).patch('/api/lender/items/itemId').set('Origin', 'http://localhost:3000');
        expect(response.status).toBe(401);
    });

    it('requesting with a member cookie should return a 403', async () => {
        User.findById.mockResolvedValue({ id: 'member1', role: 'member' });
        const memberToken = jwt.sign({ id: 'member1', role: 'member' }, env.jwtSecret, { expiresIn: '15m' });
        const response = await request(app).patch('/api/lender/items/itemId').set('Origin', 'http://localhost:3000').set('Cookie', `accessToken=${memberToken}`);
        expect(response.status).toBe(403);
    });

    it('item does not exist should return 404', async () => {
        User.findById.mockResolvedValue({ id: 'lender1', role: 'lender' });
        const lenderToken = jwt.sign({ id: 'lender1', role: 'lender' }, env.jwtSecret, { expiresIn: '15m' });
        vi.spyOn(Item, 'findById').mockResolvedValue(null);
        const response = await request(app).patch('/api/lender/items/itemId').set('Origin', 'http://localhost:3000').set('Cookie', `accessToken=${lenderToken}`).send({ name: 'Drill' });
        expect(response.status).toBe(404);
    });

    it('item exists but belongs to another lender should return 403', async () => {
        User.findById.mockResolvedValue({ id: 'lender1', role: 'lender' });
        const lenderToken = jwt.sign({ id: 'lender1', role: 'lender' }, env.jwtSecret, { expiresIn: '15m' });
        const mockItem = { _id: 'itemId', owner: 'lender2', save: vi.fn() };
        vi.spyOn(Item, 'findById').mockResolvedValue(mockItem);
        const response = await request(app).patch('/api/lender/items/itemId').set('Origin', 'http://localhost:3000').set('Cookie', `accessToken=${lenderToken}`).send({ name: 'Drill' });
        expect(mockItem.save).not.toHaveBeenCalled()
        expect(response.body.message).toBe('You do not have permission to update this item')
        expect(response.status).toBe(403);
    });

    it('item exists and belongs to lender should update item and return 200', async () => {
        User.findById.mockResolvedValue({ id: 'lender1', role: 'lender' });
        const lenderToken = jwt.sign({ id: 'lender1', role: 'lender' }, env.jwtSecret, { expiresIn: '15m' });
        const mockItem = { _id: 'itemId', owner: 'lender1', save: vi.fn() };
        vi.spyOn(Item, 'findById').mockResolvedValue(mockItem);
        const updateData = { name: 'Updated Item Name' };
        const response = await request(app).patch('/api/lender/items/itemId').set('Origin', 'http://localhost:3000').set('Cookie', `accessToken=${lenderToken}`).send(updateData);
        expect(response.status).toBe(200);
        expect(mockItem.save).toHaveBeenCalled();
        expect(mockItem.name).toBe(updateData.name);
    });

    it('item exists and belongs to lender should return 400 for invalid update data', async () => {
        User.findById.mockResolvedValue({ id: 'lender1', role: 'lender' });
        const lenderToken = jwt.sign({ id: 'lender1', role: 'lender' }, env.jwtSecret, { expiresIn: '15m' });
        const findSpy = vi.spyOn(Item, 'findById')
        const invalidUpdateData = { depositAmount: -10 };
        const response = await request(app).patch('/api/lender/items/itemId').set('Origin', 'http://localhost:3000').set('Cookie', `accessToken=${lenderToken}`).send(invalidUpdateData);
        expect(findSpy).not.toHaveBeenCalled() // Ensure that the database is not queried when validation fails
        expect(response.status).toBe(400);
        expect(response.body.message).toContain('"depositAmount" must be greater than or equal to 0');
    });

    it('category does not exist should return 400', async () => {
        User.findById.mockResolvedValue({ id: 'lender1', role: 'lender' });
        const lenderToken = jwt.sign({ id: 'lender1', role: 'lender' }, env.jwtSecret, { expiresIn: '15m' });
        const mockItem = { _id: 'itemId', owner: 'lender1', save: vi.fn() };
        vi.spyOn(Item, 'findById').mockResolvedValue(mockItem);
        const invalidUpdateData = { category: 'nonexistentCategoryId' };
        Category.findById.mockResolvedValue(null); // Simulate category not found
        const response = await request(app).patch('/api/lender/items/itemId').set('Origin', 'http://localhost:3000').set('Cookie', `accessToken=${lenderToken}`).send(invalidUpdateData);
        expect(response.status).toBe(400);
        expect(response.body.message).toBe('Category does not exist');
        expect(mockItem.save).not.toHaveBeenCalled(); // Ensure that the item is not saved when category validation fails
    });


    it('pickup location edit should update item and return 200', async () => {
        User.findById.mockResolvedValue({ id: 'lender1', role: 'lender' });
        const lenderToken = jwt.sign({ id: 'lender1', role: 'lender' }, env.jwtSecret, { expiresIn: '15m' });
        const mockItem = { _id: 'itemId', owner: 'lender1', pickup: { location: 'Old Location' }, save: vi.fn() };
        vi.spyOn(Item, 'findById').mockResolvedValue(mockItem);
        const updateData = { pickupLocation: 'New Location' };
        const response = await request(app).patch('/api/lender/items/itemId').set('Origin', 'http://localhost:3000').set('Cookie', `accessToken=${lenderToken}`).send(updateData);
        expect(response.status).toBe(200);
        expect(mockItem.save).toHaveBeenCalled();
        expect(mockItem.pickup.location).toBe(updateData.pickupLocation);
    });

    it('clear instructions should update item and return 200', async () => {
        User.findById.mockResolvedValue({ id: 'lender1', role: 'lender' });
        const lenderToken = jwt.sign({ id: 'lender1', role: 'lender' }, env.jwtSecret, { expiresIn: '15m' });
        const mockItem = { _id: 'itemId', owner: 'lender1', pickup: { instructions: 'Some instructions' }, save: vi.fn() };
        vi.spyOn(Item, 'findById').mockResolvedValue(mockItem);
        const updateData = { pickupInstructions: '' };
        const response = await request(app).patch('/api/lender/items/itemId').set('Origin', 'http://localhost:3000').set('Cookie', `accessToken=${lenderToken}`).send(updateData);
        expect(response.status).toBe(200);
        expect(mockItem.save).toHaveBeenCalled();
        expect(mockItem.pickup.instructions).toBe(updateData.pickupInstructions);
    });

    it('one borrowing rule edit should update item and return 200', async () => {
        User.findById.mockResolvedValue({ id: 'lender1', role: 'lender' });
        const lenderToken = jwt.sign({ id: 'lender1', role: 'lender' }, env.jwtSecret, { expiresIn: '15m' });
        const mockItem = { _id: 'itemId', owner: 'lender1', borrowingRules: { maxDurationDays: 7, minTrustScore: 50 }, save: vi.fn() };
        vi.spyOn(Item, 'findById').mockResolvedValue(mockItem);
        const updateData = { borrowingRules: { maxDurationDays: 10 } };
        const response = await request(app).patch('/api/lender/items/itemId').set('Origin', 'http://localhost:3000').set('Cookie', `accessToken=${lenderToken}`).send(updateData);
        expect(response.status).toBe(200);
        expect(mockItem.save).toHaveBeenCalled();
        expect(mockItem.borrowingRules.maxDurationDays).toBe(updateData.borrowingRules.maxDurationDays);
        expect(mockItem.borrowingRules.minTrustScore).toBe(50); // Ensure the other rule remains unchanged
    });

    it('owner cannot be changed', async () => {
        User.findById.mockResolvedValue({ id: 'lender1', role: 'lender' });
        const lenderToken = jwt.sign({ id: 'lender1', role: 'lender' }, env.jwtSecret, { expiresIn: '15m' });
        const mockItem = { _id: 'itemId', owner: 'lender1', save: vi.fn() };
        vi.spyOn(Item, 'findById').mockResolvedValue(mockItem);
        const updateData = { name: 'Drill', owner: 'lender2' }; // Attempt to change owner
        const response = await request(app).patch('/api/lender/items/itemId').set('Origin', 'http://localhost:3000').set('Cookie', `accessToken=${lenderToken}`).send(updateData);
        expect(response.status).toBe(200);
        expect(mockItem.save).toHaveBeenCalled();
        expect(mockItem.owner).toBe('lender1'); // Owner should not change
    })

    it('valid category should update item and return 200', async () => {
        User.findById.mockResolvedValue({ id: 'lender1', role: 'lender' });
        const lenderToken = jwt.sign({ id: 'lender1', role: 'lender' }, env.jwtSecret, { expiresIn: '15m' });
        const mockItem = { _id: 'itemId', owner: 'lender1', save: vi.fn() };
        vi.spyOn(Item, 'findById').mockResolvedValue(mockItem);
        const validCategoryId = 'validCategoryId';
        Category.findById.mockResolvedValue({ _id: validCategoryId });
        const updateData = { category: validCategoryId };
        const response = await request(app).patch('/api/lender/items/itemId').set('Origin', 'http://localhost:3000').set('Cookie', `accessToken=${lenderToken}`).send(updateData);
        expect(response.status).toBe(200);
        expect(mockItem.save).toHaveBeenCalled();
        expect(mockItem.category).toBe(validCategoryId);
    });

    it('database error should return 500', async () => {
        User.findById.mockResolvedValue({ id: 'lender1', role: 'lender' });
        const lenderToken = jwt.sign({ id: 'lender1', role: 'lender' }, env.jwtSecret, { expiresIn: '15m' });
        vi.spyOn(Item, 'findById').mockRejectedValue(new Error('Database error'));
        const response = await request(app).patch('/api/lender/items/itemId').set('Origin', 'http://localhost:3000').set('Cookie', `accessToken=${lenderToken}`).send({ name: 'Drill' });
        expect(response.status).toBe(500);
    })

});