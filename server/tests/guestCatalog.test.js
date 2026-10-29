import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { Category, Item, User } from '../models/index.js';

// SCRUM-242: a guest can browse the catalog. I never set a cookie on these requests.
vi.mock('../models/Item.js', () => ({
    Item: { find: vi.fn(), countDocuments: vi.fn(), findOne: vi.fn() }
}));

vi.mock('../models/User.js', () => ({
    User: { distinct: vi.fn() }
}));

vi.mock('../models/Category.js', () => ({
    Category: { find: vi.fn(), exists: vi.fn() }
}));

const drill = { _id: 'ITM-1', name: 'Power Drill', category: 'Tools', photos: [], depositAmount: 40 };
const drillDetails = {
    ...drill,
    description: 'Cordless, 2 batteries',
    conditionNotes: ['Small scratch on handle'],
    owner: { _id: 'martin', profile: { name: 'Martin' }, trustScore: 50 },
    pickup: { location: 'Maadi' },
    archived: false
};

const asGuest = (method, url) => request(app)[method](url);

beforeEach(() => {
    vi.resetAllMocks();
    Item.find.mockResolvedValue([drill]);
    Item.countDocuments.mockResolvedValue(1);
    Item.findOne.mockResolvedValue(drillDetails);
    User.distinct.mockResolvedValue([]);
    Category.find.mockResolvedValue([{ _id: 'Tools', name: 'Tools' }]);
    Category.exists.mockResolvedValue({ _id: 'Tools' });
});

describe('guest catalog browse (SCRUM-242)', () => {
    it.each([
        { from: 'the item list', method: 'get', url: '/api/items' },
        { from: 'search', method: 'get', url: '/api/items?search=dri' },
        { from: 'the category filter', method: 'get', url: '/api/items?category=Tools' },
        { from: 'item details', method: 'get', url: '/api/items/ITM-1' },
        { from: 'the category list', method: 'get', url: '/api/categories' },
        { from: 'a category page', method: 'get', url: '/api/categories/Tools/items' }
    ])('lets a guest open $from with no cookie', async ({ method, url }) => {
        const response = await asGuest(method, url);

        expect(response.status).toBe(200);
        expect(response.headers['set-cookie']).toBeUndefined();
    });

    // the "must register to reserve" half of SCRUM-242. there is no reserve endpoint yet
    // (SCRUM-340 / SCRUM-412, sprint 2). a guest POST with no Origin hits CSRF first and gets 403.
    // when that endpoint lands it should sit behind requireAuth so a guest with a trusted Origin gets 401.
    it('blocks a guest reserve attempt before routing', async () => {
        const response = await asGuest('post', '/api/items/ITM-1/reservations');

        expect(response.status).toBe(403);
        expect(response.body).toEqual({ message: 'Untrusted request origin' });
    });

    // guest catalog writes with no Origin also stop at CSRF (403), not at a missing route (404).
    // lender create is SCRUM-229 on another branch and should sit behind requireAuth.
    it.each(['post', 'put', 'delete'])('blocks a guest %s on /api/items at CSRF', async method => {
        const response = await asGuest(method, '/api/items');

        expect(response.status).toBe(403);
        expect(response.body).toEqual({ message: 'Untrusted request origin' });
    });
});
