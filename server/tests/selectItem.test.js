import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { Category, Item, User } from '../models/index.js';

// SCRUM-241 has no endpoint of its own. selecting a result means taking its _id from the list
// and opening GET /api/items/:id, so these tests check the two endpoints fit together
vi.mock('../models/Item.js', () => ({
    Item: { find: vi.fn(), countDocuments: vi.fn(), findOne: vi.fn() }
}));

vi.mock('../models/User.js', () => ({
    User: { distinct: vi.fn() }
}));

vi.mock('../models/Category.js', () => ({
    Category: { exists: vi.fn() }
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

// lists the results, then opens the first one the way the frontend would
async function selectFirst(url, query) {
    const listResponse = await request(app).get(url).query(query);
    const selectedId = listResponse.body.items[0]._id;
    return request(app).get(`/api/items/${selectedId}`);
}

beforeEach(() => {
    vi.resetAllMocks();
    Item.find.mockResolvedValue([drill]);
    Item.countDocuments.mockResolvedValue(1);
    Item.findOne.mockResolvedValue(drillDetails);
    User.distinct.mockResolvedValue([]);
    Category.exists.mockResolvedValue({ _id: 'Tools' });
});

describe('selecting an item from the results', () => {
    it('keeps _id in the list projection so every result can be opened', async () => {
        await request(app).get('/api/items');

        const [, projection] = Item.find.mock.calls[0];
        expect(projection._id).not.toBe(0);
    });

    it.each([
        { from: 'search results', url: '/api/items', query: { search: 'dri' } },
        { from: 'category filter results', url: '/api/items', query: { category: 'Tools' } },
        { from: 'category page results', url: '/api/categories/items', query: { category: 'Tools' } }
    ])('opens the details of an item picked from the $from', async ({ url, query }) => {
        const response = await selectFirst(url, query);

        expect(response.status).toBe(200);
        expect(response.body.item).toMatchObject({ _id: 'ITM-1', name: 'Power Drill', depositAmount: 40 });
        expect(Item.findOne.mock.calls[0][0]).toEqual({ _id: 'ITM-1', flagged: { $ne: true } });
    });

    // the list and the click are two requests, so the item can get flagged or its owner suspended in between.
    // details gives a 404 then, and the frontend should treat it as "no longer available"
    it.each([
        // the details query filters flagged out, so a flagged or deleted item both come back as null
        { change: 'the item was flagged or deleted', details: null },
        { change: 'the owner was suspended', details: { ...drillDetails, owner: { ...drillDetails.owner, suspended: true } } }
    ])('returns 404 if $change after the list loaded', async ({ details }) => {
        Item.findOne.mockResolvedValue(details);

        const response = await selectFirst('/api/items', {});

        expect(response.status).toBe(404);
        expect(response.body).toEqual({ message: 'Item not found' });
    });

    // archived still opens from a direct link, so a result archived after the list loaded still opens too
    it('still opens an item that was archived after the list loaded', async () => {
        Item.findOne.mockResolvedValue({ ...drillDetails, archived: true });

        const response = await selectFirst('/api/items', {});

        expect(response.status).toBe(200);
        expect(response.body.item.archived).toBe(true);
    });
});
