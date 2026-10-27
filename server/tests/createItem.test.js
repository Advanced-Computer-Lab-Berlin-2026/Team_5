import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { Item, Category } from '../models/index.js';

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
    const mockCategory = { _id: 'categoryId' };
    const validBody = { name: 'Test Item', 
        description: 'Test Description', 
        category: 'categoryId', 
        depositAmount: 100, 
        conditionNotes: ['Good'], 
        pickupLocation: 'Test Location' };

    it('should create a new item and return 201 status', async () => {
        Category.findById.mockResolvedValue(mockCategory);
        Item.create.mockResolvedValue({ ...validBody, _id: 'itemId' });
    const response = await request(app).post('/api/lender/items').set('Origin', 'http://localhost:3000').send(validBody);
    expect(response.status).toBe(201);
    expect(response.body.item).toEqual({ ...validBody, _id: 'itemId' });
    expect(Item.create.mock.calls[0][0].owner).toBe('TEMP_OWNER')
    }
);
    it('should return 400 if category does not exist', async () => {
        Category.findById.mockResolvedValue(null);
        const response = await request(app).post('/api/lender/items').set('Origin', 'http://localhost:3000').send(validBody);
        expect(response.status).toBe(400);
        expect(response.body.message).toBe('Category does not exist');
        expect(Item.create).not.toHaveBeenCalled()
    });
    
    it('a missing field should return 400', async () => {
        const invalidBody = { ...validBody };
        delete invalidBody.name;
        const response = await request(app).post('/api/lender/items').set('Origin', 'http://localhost:3000').send(invalidBody);
        expect(response.status).toBe(400);
        expect(response.body.message).toContain('"name" is required');
        expect(Item.create).not.toHaveBeenCalled()
    });

    it('client sends owner field, should be ignored and not set on the item', async () => {
        Category.findById.mockResolvedValue(mockCategory);
        const bodyWithOwner = { ...validBody, owner: 'maliciousUser' };
        Item.create.mockResolvedValue({ ...validBody, _id: 'itemId' });
        const response = await request(app).post('/api/lender/items').set('Origin', 'http://localhost:3000').send(bodyWithOwner);
        expect(response.status).toBe(201);
        expect(Item.create.mock.calls[0][0].owner).toBe('TEMP_OWNER')
    });

    it('the database throws an error, should return 500', async () => {
        Category.findById.mockResolvedValue(mockCategory);
        Item.create.mockRejectedValue(new Error('Database error'));
        const response = await request(app).post('/api/lender/items').set('Origin', 'http://localhost:3000').send(validBody);
        expect(response.status).toBe(500);
        expect(response.body.message).toBe('Server Error');
    });

});