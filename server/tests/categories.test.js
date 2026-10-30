import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { Category, Item, User } from '../models/index.js';

vi.mock('../models/Category.js', () => ({
    Category: { find: vi.fn(), exists: vi.fn() }
}));

// the category items page goes through listItems, so it needs the same mocks as items.test.js
vi.mock('../models/Item.js', () => ({
    Item: { find: vi.fn(), countDocuments: vi.fn(), findOne: vi.fn() }
}));

vi.mock('../models/User.js', () => ({
    User: { distinct: vi.fn() }
}));

const drill = { _id: 'ITM-1', name: 'Power Drill', category: 'Tools', photos: [], depositAmount: 40 };

const categoryItems = query => request(app).get('/api/categories/items').query(query);

beforeEach(() => {
    vi.resetAllMocks();
    Category.exists.mockResolvedValue({ _id: 'Tools' });
    Item.find.mockResolvedValue([drill]);
    Item.countDocuments.mockResolvedValue(1);
    User.distinct.mockResolvedValue([]);
});

describe('GET /api/categories', () => {
    it('returns each category with its _id and name, sorted by name', async () => {
        const categories = [{ _id: 'Camping', name: 'Camping' }, { _id: 'tools', name: 'Tools' }];
        Category.find.mockResolvedValue(categories);

        const response = await request(app).get('/api/categories');

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ categories });
        expect(Category.find).toHaveBeenCalledExactlyOnceWith({}, { name: 1 }, { sort: { name: 1 }, lean: true });
    });

    it('returns 500 when the database fails', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        Category.find.mockRejectedValue(new Error('db down'));

        const response = await request(app).get('/api/categories');

        expect(response.status).toBe(500);
    });
});

describe('GET /api/categories/items', () => {
    it('returns the items of that category with pagination', async () => {
        const response = await categoryItems({ category: 'Tools' });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            items: [drill],
            pagination: { total: 1, page: 1, totalPages: 1, limit: 10 }
        });
        expect(Category.exists).toHaveBeenCalledExactlyOnceWith({ _id: 'Tools' });
        expect(Item.find).toHaveBeenCalledExactlyOnceWith(
            { archived: false, flagged: { $ne: true }, category: 'Tools' },
            { name: 1, category: 1, photos: 1, depositAmount: 1 },
            { sort: { createdAt: -1, _id: 1 }, skip: 0, limit: 10, lean: true }
        );
    });

    it('looks up ?category= as the _id only, so a name that is not an _id is a 404', async () => {
        Category.exists.mockResolvedValue(null);

        const response = await categoryItems({ category: 'Power Tools' });

        expect(response.status).toBe(404);
        expect(Category.exists).toHaveBeenCalledExactlyOnceWith({ _id: 'Power Tools' });
        expect(Item.find).not.toHaveBeenCalled();
    });

    it('leaves archived items out of the category page', async () => {
        await categoryItems({ category: 'Tools' });

        expect(Item.find.mock.calls[0][0].archived).toBe(false);
        expect(Item.countDocuments.mock.calls[0][0].archived).toBe(false);
    });

    it('returns 400 for ?archived=true, same as /api/items', async () => {
        const response = await categoryItems({ category: 'Tools', archived: true });

        expect(response.status).toBe(400);
        expect(Item.find).not.toHaveBeenCalled();
    });

    it('returns 404 for a category that does not exist', async () => {
        Category.exists.mockResolvedValue(null);

        const response = await categoryItems({ category: 'Nope' });

        expect(response.status).toBe(404);
        expect(response.body).toEqual({ message: 'Category not found' });
        expect(Item.find).not.toHaveBeenCalled();
    });

    it('returns 404 when ?category= is missing', async () => {
        const response = await categoryItems({});

        expect(response.status).toBe(404);
        expect(response.body).toEqual({ message: 'Category not found' });
        expect(Category.exists).not.toHaveBeenCalled();
        expect(Item.find).not.toHaveBeenCalled();
    });

    it('keeps the normal list filters, search, suspended owners and paging', async () => {
        User.distinct.mockResolvedValue(['banned']);

        const response = await categoryItems({ category: 'Tools', search: 'dri', page: 2, limit: 5 });

        expect(response.status).toBe(200);
        expect(Item.find).toHaveBeenCalledExactlyOnceWith(
            {
                archived: false,
                flagged: { $ne: true },
                category: 'Tools',
                name: { $regex: 'dri', $options: 'i' },
                owner: { $nin: ['banned'] }
            },
            { name: 1, category: 1, photos: 1, depositAmount: 1 },
            { sort: { createdAt: -1, _id: 1 }, skip: 5, limit: 5, lean: true }
        );
    });

    it('returns 400 for a bad page', async () => {
        const response = await categoryItems({ category: 'Tools', page: 0 });

        expect(response.status).toBe(400);
        expect(Item.find).not.toHaveBeenCalled();
    });

    it('returns 500 when the category lookup fails', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        Category.exists.mockRejectedValue(new Error('db down'));

        const response = await categoryItems({ category: 'Tools' });

        expect(response.status).toBe(500);
        expect(Item.find).not.toHaveBeenCalled();
    });
});
