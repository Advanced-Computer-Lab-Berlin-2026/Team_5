import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { Item, User } from '../models/index.js';

// I mock only the Item functions the list and details endpoints call
vi.mock('../models/Item.js', () => ({
    Item: { find: vi.fn(), countDocuments: vi.fn(), findOne: vi.fn() }
}));

// the list looks up suspended owners first
vi.mock('../models/User.js', () => ({
    User: { distinct: vi.fn() }
}));

const drill = { _id: 'ITM-1', name: 'Power Drill', category: 'Tools', photos: [{ url: 'https://img/drill.jpg' }], depositAmount: 40 };
const ladder = { _id: 'ITM-2', name: 'Ladder', category: 'Tools', photos: [], depositAmount: 25 };

const list = query => request(app).get('/api/items').query(query ?? {});

beforeEach(() => {
    vi.resetAllMocks();
    Item.find.mockResolvedValue([drill, ladder]);
    Item.countDocuments.mockResolvedValue(2);
    User.distinct.mockResolvedValue([]);
});

describe('GET /api/items', () => {
    it('returns the first page of available items with pagination', async () => {
        const response = await list();

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            items: [drill, ladder],
            pagination: { total: 2, page: 1, totalPages: 1, limit: 10 }
        });
        expect(Item.find).toHaveBeenCalledExactlyOnceWith(
            { archived: false, flagged: { $ne: true } },
            { name: 1, category: 1, photos: 1, depositAmount: 1 },
            { sort: { createdAt: -1, _id: 1 }, skip: 0, limit: 10, lean: true }
        );
        expect(Item.countDocuments).toHaveBeenCalledExactlyOnceWith({ archived: false, flagged: { $ne: true } });
    });

    it('skips earlier pages and counts total pages', async () => {
        Item.countDocuments.mockResolvedValue(12);

        const response = await list({ page: 3, limit: 5 });

        expect(response.status).toBe(200);
        expect(response.body.pagination).toEqual({ total: 12, page: 3, totalPages: 3, limit: 5 });
        const options = Item.find.mock.calls[0][2];
        expect(options.skip).toBe(10);
        expect(options.limit).toBe(5);
    });

    it('filters by category', async () => {
        await list({ category: ' Tools ' });

        expect(Item.find.mock.calls[0][0]).toEqual({ archived: false, flagged: { $ne: true }, category: 'Tools' });
        expect(Item.countDocuments).toHaveBeenCalledWith({ archived: false, flagged: { $ne: true }, category: 'Tools' });
    });

    it.each([
        [undefined, false],
        ['false', false],
        ['true', true]
    ])('uses archived=%s as %s', async (archived, expected) => {
        await list(archived === undefined ? {} : { archived });

        expect(Item.find.mock.calls[0][0].archived).toBe(expected);
    });

    it('searches names case insensitive', async () => {
        await list({ search: ' drill ' });

        const filter = Item.find.mock.calls[0][0];
        expect(filter.name).toEqual({ $regex: 'drill', $options: 'i' });
        expect(Item.countDocuments).toHaveBeenCalledWith(filter);
    });

    // part of a word is enough, "dri" finds "Power Drill"
    // I run the regex the controller built against the real name
    it('matches part of a name', async () => {
        await list({ search: 'dri' });

        const { name } = Item.find.mock.calls[0][0];
        expect(new RegExp(name.$regex, name.$options).test('Power Drill')).toBe(true);
        expect(new RegExp(name.$regex, name.$options).test('Ladder')).toBe(false);
    });

    it('treats regex characters in the search as plain text', async () => {
        await list({ search: 'drill (18v)' });

        const { name } = Item.find.mock.calls[0][0];
        expect(name.$regex).toBe('drill \\(18v\\)');
        expect(new RegExp(name.$regex, name.$options).test('Drill (18V)')).toBe(true);
    });

    it('combines search, category and archived in one filter', async () => {
        await list({ search: 'drill', category: 'Tools', archived: 'true' });

        expect(Item.find.mock.calls[0][0]).toEqual({
            archived: true,
            flagged: { $ne: true },
            category: 'Tools',
            name: { $regex: 'drill', $options: 'i' }
        });
    });

    // flagged items stay out of search results, same as details
    it('leaves flagged items out of search results', async () => {
        Item.find.mockResolvedValue([drill]);
        Item.countDocuments.mockResolvedValue(1);

        const response = await list({ search: 'drill' });

        expect(response.status).toBe(200);
        expect(response.body.items).toEqual([drill]);
        const filter = Item.find.mock.calls[0][0];
        expect(filter.flagged).toEqual({ $ne: true });
        expect(filter.name).toEqual({ $regex: 'drill', $options: 'i' });
        expect(Item.countDocuments).toHaveBeenCalledWith(filter);
    });

    it('returns an empty list when nothing matches', async () => {
        Item.find.mockResolvedValue([]);
        Item.countDocuments.mockResolvedValue(0);

        const response = await list({ search: 'submarine' });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            items: [],
            pagination: { total: 0, page: 1, totalPages: 0, limit: 10 }
        });
    });

    it('returns an empty page past the last one', async () => {
        Item.find.mockResolvedValue([]);
        Item.countDocuments.mockResolvedValue(3);

        const response = await list({ page: 5 });

        expect(response.status).toBe(200);
        expect(response.body.items).toEqual([]);
        expect(response.body.pagination.totalPages).toBe(1);
    });

    it.each([
        { page: 0 },
        { page: -1 },
        { page: 1.5 },
        { page: 'abc' },
        { limit: 0 },
        { limit: 51 },
        { archived: 'maybe' },
        { category: '' },
        { search: '   ' },
        { search: 'x'.repeat(101) },
        { sort: 'name' }
    ])('returns 400 for invalid query %o', async query => {
        const response = await list(query);

        expect(response.status).toBe(400);
        expect(Item.find).not.toHaveBeenCalled();
        expect(Item.countDocuments).not.toHaveBeenCalled();
    });

    it.each(['find', 'countDocuments'])('returns 500 when %s fails', async operation => {
        Item[operation].mockRejectedValue(new Error('Database unavailable'));

        const response = await list();

        expect(response.status).toBe(500);
        expect(response.body).not.toHaveProperty('items');
    });

    // suspended lenders' items drop out of the list
    // the filter has to be in the query so total/totalPages don't count them
    // I suspend sam and check his items are excluded while everyone else's still come back
    it('leaves out items from suspended owners and keeps the rest', async () => {
        User.distinct.mockResolvedValue(['sam']);
        Item.find.mockResolvedValue([drill]);
        Item.countDocuments.mockResolvedValue(1);

        const response = await list();

        expect(response.status).toBe(200);
        expect(response.body.items).toEqual([drill]);
        expect(response.body.pagination.total).toBe(1);
        expect(User.distinct).toHaveBeenCalledExactlyOnceWith('_id', { suspended: true });
        expect(Item.find.mock.calls[0][0]).toEqual({ archived: false, flagged: { $ne: true }, owner: { $nin: ['sam'] } });
        expect(Item.countDocuments).toHaveBeenCalledExactlyOnceWith({ archived: false, flagged: { $ne: true }, owner: { $nin: ['sam'] } });
    });

    it('combines flagged, search, category and suspended owners in one query', async () => {
        User.distinct.mockResolvedValue(['sam']);

        await list({ search: 'dri', category: 'Tools' });

        const expected = {
            archived: false,
            flagged: { $ne: true },
            category: 'Tools',
            name: { $regex: 'dri', $options: 'i' },
            owner: { $nin: ['sam'] }
        };
        expect(Item.find.mock.calls[0][0]).toEqual(expected);
        expect(Item.countDocuments).toHaveBeenCalledExactlyOnceWith(expected);
    });
});

// fake owner has the secret fields on purpose
// so the tests can prove none of them leak

const ownerFromDb = {
    _id: 'martin',
    username: 'martin',
    password: '$2b$10$hashhashhash',
    wallet: 500,
    profile: { name: 'Martin', email: 'martin@example.com', phone: '+201000000000' }
};
const fullDrill = {
    ...drill,
    description: 'Cordless, 2 batteries',
    conditionNotes: ['Small scratch on handle'],
    owner: ownerFromDb,
    pickup: { location: 'Maadi' },
    archived: false
};
const details = id => request(app).get(`/api/items/${id}`);

describe('GET /api/items/:id', () => {
    it('returns the item with owner name', async () => {
        Item.findOne.mockResolvedValue(fullDrill);

        const response = await details('ITM-1');

        expect(response.status).toBe(200);
        expect(response.body.item).toEqual({ ...fullDrill, owner: { name: 'Martin' } });
        expect(Item.findOne).toHaveBeenCalledExactlyOnceWith(
            { _id: 'ITM-1', flagged: { $ne: true } },
            { flagged: 0, __v: 0 },
            { lean: true, populate: { path: 'owner', select: 'profile.name suspended' } }
        );
    });

    it('returns 404 when the item does not exist', async () => {
        Item.findOne.mockResolvedValue(null);

        const response = await details('ITM-missing');

        expect(response.status).toBe(404);
        expect(response.body).toEqual({ message: 'Item not found' });
    });

    // flagged = 404 for everyone
    // reported items shouldn't be publicly accessible
    // I check the query filters flagged out and the projection drops the field
    it('hides flagged items and never sends the flagged field', async () => {
        Item.findOne.mockResolvedValue(null);

        const response = await details('ITM-flagged');

        expect(response.status).toBe(404);
        const [filter, projection] = Item.findOne.mock.calls[0];
        expect(filter.flagged).toEqual({ $ne: true });
        expect(projection.flagged).toBe(0);
    });

    // archived still opens from a direct link
    // reservation history needs it and the lender might unarchive
    // I check it's a 200 and the query has no archived key
    it('still opens archived items from a direct link', async () => {
        Item.findOne.mockResolvedValue({ ...fullDrill, archived: true });

        const response = await details('ITM-1');

        expect(response.status).toBe(200);
        expect(response.body.item.archived).toBe(true);
        expect(Item.findOne.mock.calls[0][0]).not.toHaveProperty('archived');
    });

    it('only asks the database for owner name and suspended flag', async () => {
        Item.findOne.mockResolvedValue(fullDrill);

        await details('ITM-1');

        expect(Item.findOne.mock.calls[0][2].populate.select).toBe('profile.name suspended');
    });

    // owner is name only
    // username/password/email/phone/wallet must never show up in the body
    // I feed it a fake owner with all of them and search the raw json
    it('never leaks owner username, password, email, phone or wallet', async () => {
        Item.findOne.mockResolvedValue(fullDrill);

        const response = await details('ITM-1');

        expect(response.body.item.owner).toEqual({ name: 'Martin' });
        const raw = JSON.stringify(response.body);
        for (const secret of ['"martin"', 'username', '$2b$10$hashhashhash', 'martin@example.com', '+201000000000', 'password', 'wallet']) {
            expect(raw).not.toContain(secret);
        }
    });

    // suspended lender = 404, like the item doesn't exist
    // matches the list, which leaves their items out
    // I give the fake owner suspended true and expect the same 404 as a missing item
    it('returns 404 when the owner is suspended', async () => {
        Item.findOne.mockResolvedValue({ ...fullDrill, owner: { ...ownerFromDb, suspended: true } });

        const response = await details('ITM-1');

        expect(response.status).toBe(404);
        expect(response.body).toEqual({ message: 'Item not found' });
    });

    it('still returns the item when the owner is not suspended', async () => {
        Item.findOne.mockResolvedValue({ ...fullDrill, owner: { ...ownerFromDb, suspended: false } });

        const response = await details('ITM-1');

        expect(response.status).toBe(200);
        expect(response.body.item.owner).toEqual({ name: 'Martin' });
    });

    it('returns an empty owner when the owner has no profile', async () => {
        Item.findOne.mockResolvedValue({ ...fullDrill, owner: { _id: 'martin' } });

        const response = await details('ITM-1');

        expect(response.status).toBe(200);
        expect(response.body.item.owner).toEqual({});
    });

    it('returns owner null when the owner account is gone', async () => {
        Item.findOne.mockResolvedValue({ ...fullDrill, owner: null });

        const response = await details('ITM-1');

        expect(response.status).toBe(200);
        expect(response.body.item.owner).toBeNull();
    });

    it('returns 500 when the lookup fails', async () => {
        Item.findOne.mockRejectedValue(new Error('Database unavailable'));

        const response = await details('ITM-1');

        expect(response.status).toBe(500);
        expect(response.body).not.toHaveProperty('item');
    });

    // /api/items still goes to the list
    // checks the route order in routes/items.js
    // I hit GET /api/items and expect find, not findOne
    it('does not route the list endpoint to details', async () => {
        await request(app).get('/api/items');

        expect(Item.find).toHaveBeenCalledOnce();
        expect(Item.findOne).not.toHaveBeenCalled();
    });
});
