import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { Item, Category, User } from '../models/index.js';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

vi.mock('../models/User.js', () => ({
    User: { findById: vi.fn() }
}));

vi.mock('../models/Item.js', () => ({
    Item: { create: vi.fn() }
}));

vi.mock('../models/Category.js', () => ({
    Category: { findById: vi.fn() }
}));

beforeEach(() => {
    vi.resetAllMocks();
});

describe('POST /api/lender/items', () => {

    beforeEach(() => {
        User.findById.mockResolvedValue({ id: 'lender1', role: 'lender' });
    });

    const mockCategory = { _id: 'categoryId' };
    const validBody = { name: 'Test Item', 
        description: 'Test Description', 
        category: 'categoryId', 
        depositAmount: 100, 
        conditionNotes: ['Good'], 
        pickupLocation: 'Test Location' };
    const lenderToken = jwt.sign({ id: 'lender1', role: 'lender' }, env.jwtSecret, { expiresIn: '15m' });
    const memberToken = jwt.sign({ id: 'member1', role: 'member' }, env.jwtSecret, { expiresIn: '15m' });

    it('should create a new item and return 201 status', async () => {
        Category.findById.mockResolvedValue(mockCategory);
        Item.create.mockResolvedValue({ ...validBody, _id: 'itemId' });
    const response = await request(app).post('/api/lender/items').set('Origin', 'http://localhost:3000').set('Cookie', `accessToken=${lenderToken}`).send(validBody);
    expect(response.status).toBe(201);
    expect(response.body.item).toEqual({ ...validBody, _id: 'itemId' });
    expect(Item.create.mock.calls[0][0].owner).toBe('lender1')
    }
);
    it('should return 400 if category does not exist', async () => {
        Category.findById.mockResolvedValue(null);
        const response = await request(app).post('/api/lender/items').set('Origin', 'http://localhost:3000').set('Cookie', `accessToken=${lenderToken}`).send(validBody);
        expect(response.status).toBe(400);
        expect(response.body.message).toBe('Category does not exist');
        expect(Item.create).not.toHaveBeenCalled()
    });
    
    it('a missing field should return 400', async () => {
        const invalidBody = { ...validBody };
        delete invalidBody.name;
        const response = await request(app).post('/api/lender/items').set('Origin', 'http://localhost:3000').set('Cookie', `accessToken=${lenderToken}`).send(invalidBody);
        expect(response.status).toBe(400);
        expect(response.body.message).toContain('"name" is required');
        expect(Item.create).not.toHaveBeenCalled()
    });

    it('client sends owner field, should be ignored and not set on the item', async () => {
        Category.findById.mockResolvedValue(mockCategory);
        const bodyWithOwner = { ...validBody, owner: 'maliciousUser' };
        Item.create.mockResolvedValue({ ...validBody, _id: 'itemId' });
        const response = await request(app).post('/api/lender/items').set('Origin', 'http://localhost:3000').set('Cookie', `accessToken=${lenderToken}`).send(bodyWithOwner);
        expect(response.status).toBe(201);
        expect(Item.create.mock.calls[0][0].owner).toBe('lender1') 
    });

    it('the database throws an error, should return 500', async () => {
        Category.findById.mockResolvedValue(mockCategory);
        Item.create.mockRejectedValue(new Error('Database error'));
        const response = await request(app).post('/api/lender/items').set('Origin', 'http://localhost:3000').set('Cookie', `accessToken=${lenderToken}`).send(validBody);
        expect(response.status).toBe(500);
        expect(response.body.message).toBe('Server Error');
    });

    it('should return 401 if no cookie is sent', async () => {
        const response = await request(app).post('/api/lender/items').set('Origin', 'http://localhost:3000').send(validBody);
        expect(response.status).toBe(401);
        expect(response.body.message).toBe('Authentication required');
        expect(Item.create).not.toHaveBeenCalled()
    });

    it('should return 403 if a member tries to create an item', async () => {
        User.findById.mockResolvedValue({ id: 'member1', role: 'member' });           
        const response = await request(app).post('/api/lender/items').set('Origin', 'http://localhost:3000').set('Cookie', `accessToken=${memberToken}`).send(validBody);
        expect(response.status).toBe(403);
        expect(response.body.message).toBe('You do not have permission to do this');
        expect(Item.create).not.toHaveBeenCalled()
    });

});