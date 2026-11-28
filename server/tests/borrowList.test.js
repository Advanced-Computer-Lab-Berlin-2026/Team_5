import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../app.js";
import { env } from "../config/env.js";
import { User } from "../models/User.js";
import { Item } from "../models/Item.js";
import { Reservation } from "../models/Reservation.js";
import { Waitlist } from '../models/Waitlist.js';

vi.mock('../models/Waitlist.js', () => ({ Waitlist: { find: vi.fn() } }));

vi.mock('../models/User.js', () => ({
    User: { findById: vi.fn(), updateOne: vi.fn(), exists: vi.fn(), find: vi.fn() }
}));

vi.mock('../models/Item.js', () => ({
    Item: { findOne: vi.fn() }
}));

vi.mock('../models/Reservation.js', () => ({
    Reservation: { findOverlap: vi.fn(), find: vi.fn() },
    BLOCKING_STATUSES: []
}));

const USER_ID = 'Youries';
const BASE_URL = '/api/borrow-list';
const ITEM_ID = 'ITM-1a2b3c01';
const ORIGIN = 'http://localhost:3000';

let loggedInRole;
let borrowListUser;

function daysFromNow(days) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

const START = daysFromNow(3);
const END = daysFromNow(6);
const NEW_START = daysFromNow(10);
const NEW_END = daysFromNow(12);

function fakeItem(owner = { _id: 'martinies', suspended: false }) {
    return { _id: ITEM_ID, owner };
}

function findUserById(id, projection) {
    if (id !== USER_ID) return Promise.resolve(null);
    if (projection === 'borrow_list') return Promise.resolve(borrowListUser);
    return Promise.resolve({ _id: USER_ID, role: loggedInRole, suspended: false });
}

function loginCookie(role) {
    loggedInRole = role;
    return `accessToken=${jwt.sign({ id: USER_ID, role }, env.jwtSecret, { expiresIn: '15m' })}`;
}

function asMember(req, role = 'member') {
    return req.set('Cookie', loginCookie(role)).set('Origin', ORIGIN);
}

function addItem(body = { startDate: START, endDate: END }, itemId = ITEM_ID) {
    return asMember(request(app).post(`${BASE_URL}/${itemId}`)).send(body);
}

function updateDates(body = { startDate: NEW_START, endDate: NEW_END }, itemId = ITEM_ID) {
    return asMember(request(app).patch(`${BASE_URL}/${itemId}`)).send(body);
}

beforeEach(() => {
    vi.resetAllMocks();
    User.exists.mockResolvedValue({ _id: USER_ID });

    borrowListUser = {
        _id: USER_ID,
        borrow_list: [
            { item: { _id: ITEM_ID, name: 'Cordless Drill', category: 'Tools', depositAmount: 180, pickup: { location: 'Maadi' }, owner: 'martinies', archived: false }, startDate: START, endDate: END }
        ]
    };
    User.findById.mockImplementation(findUserById);
    User.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    Item.findOne.mockResolvedValue(fakeItem());
    Reservation.findOverlap.mockResolvedValue(null);
    Reservation.find.mockResolvedValue([]);
    Waitlist.find.mockResolvedValue([]);
});

describe('Borrower access', () => {
    it.each([
        ['GET', BASE_URL],
        ['POST', `${BASE_URL}/${ITEM_ID}`]
    ])('returns 401 for %s %s when not logged in', async (method, url) => {
        const response = await request(app)[method.toLowerCase()](url).set('Origin', ORIGIN);

        expect(response.status).toBe(401);
    });

    it('returns 403 when the user is an admin', async () => {
        const response = await asMember(request(app).post(`${BASE_URL}/${ITEM_ID}`), 'admin').send({ startDate: START, endDate: END });

        expect(response.status).toBe(403);
        expect(User.updateOne).not.toHaveBeenCalled();
    });

    it.each(['member', 'lender'])('lets a %s add items', async (role) => {
        const response = await asMember(request(app).post(`${BASE_URL}/${ITEM_ID}`), role).send({ startDate: START, endDate: END });

        expect(response.status).toBe(201);
    });
});

describe('POST /api/borrow-list/:itemId', () => {
    it('rejects both add and date changes through a higher-priority hold', async () => {
        Waitlist.find.mockResolvedValue([
            { username: USER_ID, startDate: new Date(START), endDate: new Date(END) },
            { username: 'premium', startDate: new Date(START), endDate: new Date(END) }
        ]);
        User.find.mockResolvedValue([{ _id: USER_ID }, { _id: 'premium', membership: { tier: 'Premium' } }]);
        const responses = await Promise.all([addItem(), updateDates({ startDate: START, endDate: END })]);
        for (const response of responses) {
            expect(response.status).toBe(409);
            expect(response.body.error).toBe('WAITLIST_PRIORITY');
        }
        expect(User.updateOne).not.toHaveBeenCalled();
    });

    it('returns 201 and adds the item with its dates to the borrow list', async () => {
        const response = await addItem();

        expect(response.status).toBe(201);
        expect(response.body).toEqual({
            message: 'Item added to borrow list',
            entry: { item: ITEM_ID, startDate: `${START}T00:00:00.000Z`, endDate: `${END}T00:00:00.000Z` }
        });
        expect(User.updateOne).toHaveBeenCalledWith(
            { _id: USER_ID, 'borrow_list.item': { $ne: ITEM_ID } },
            { $push: { borrow_list: { item: ITEM_ID, startDate: new Date(START), endDate: new Date(END) } } }
        );
    });

    it('adds several items one after another for one pickup trip', async () => {
        await addItem();
        await addItem({ startDate: START, endDate: END }, 'ITM-1a2b3c02');

        expect(User.updateOne).toHaveBeenCalledTimes(2);
        expect(User.updateOne.mock.calls[1][1].$push.borrow_list.item).toBe('ITM-1a2b3c02');
    });

    it('accepts a start date of today', async () => {
        const response = await addItem({ startDate: daysFromNow(0), endDate: daysFromNow(2) });

        expect(response.status).toBe(201);
    });

    it('only looks for items that are not archived or flagged', async () => {
        await addItem();

        expect(Item.findOne).toHaveBeenCalledWith(
            { _id: ITEM_ID, archived: false, flagged: { $ne: true } },
            'owner delivery',
            { lean: true, populate: { path: 'owner', select: 'suspended' } }
        );
    });

    it('checks the item is free for the chosen dates', async () => {
        await addItem();

        expect(Reservation.findOverlap).toHaveBeenCalledWith(ITEM_ID, new Date(START), new Date(END));
    });

    it('returns 409 when the item is already reserved for those dates', async () => {
        Reservation.findOverlap.mockResolvedValue({ _id: 'RES-00000001' });

        const response = await addItem();

        expect(response.status).toBe(409);
        expect(response.body).toEqual({ message: 'Item is not available for these dates' });
        expect(User.updateOne).not.toHaveBeenCalled();
    });

    it('returns 409 when the item is already in the borrow list', async () => {
        User.updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });

        const response = await addItem();

        expect(response.status).toBe(409);
        expect(response.body).toEqual({ message: 'Item is already in your borrow list' });
    });

    it.each([
        ['does not exist, is archived or is flagged', null],
        ['belongs to a suspended owner', fakeItem({ _id: 'martinies', suspended: true })],
        ['belongs to a deleted owner', fakeItem(null)]
    ])('returns 404 when the item %s', async (_case, item) => {
        Item.findOne.mockResolvedValue(item);

        const response = await addItem();

        expect(response.status).toBe(404);
        expect(Reservation.findOverlap).not.toHaveBeenCalled();
        expect(User.updateOne).not.toHaveBeenCalled();
    });

    it('returns 403 when the user tries to borrow their own item', async () => {
        Item.findOne.mockResolvedValue(fakeItem({ _id: USER_ID, suspended: false }));

        const response = await addItem();

        expect(response.status).toBe(403);
        expect(User.updateOne).not.toHaveBeenCalled();
    });

    it.each([
        ['an invalid item id', { startDate: START, endDate: END }, 'drill'],
        ['an empty body', {}, ITEM_ID],
        ['no end date', { startDate: START }, ITEM_ID],
        ['an end date before the start date', { startDate: END, endDate: START }, ITEM_ID],
        ['the same start and end date', { startDate: START, endDate: START }, ITEM_ID],
        ['a start date in the past', { startDate: daysFromNow(-1), endDate: END }, ITEM_ID],
        ['a date that is not a date', { startDate: 'soon', endDate: END }, ITEM_ID],
        ['an unknown field', { startDate: START, endDate: END, quantity: 2 }, ITEM_ID]
    ])('returns 400 for %s', async (_case, body, itemId) => {
        const response = await addItem(body, itemId);

        expect(response.status).toBe(400);
        expect(Item.findOne).not.toHaveBeenCalled();
        expect(User.updateOne).not.toHaveBeenCalled();
    });

    it('returns 500 when the database fails', async () => {
        User.updateOne.mockRejectedValue(new Error('Database unavailable'));

        const response = await addItem();

        expect(response.status).toBe(500);
        expect(response.body).toEqual({ message: 'Server Error' });
    });
});

describe('PATCH /api/borrow-list/:itemId', () => {
    it('returns 401 when not logged in', async () => {
        const response = await request(app).patch(`${BASE_URL}/${ITEM_ID}`).set('Origin', ORIGIN);

        expect(response.status).toBe(401);
    });

    it('returns 403 when the user is an admin', async () => {
        const response = await asMember(request(app).patch(`${BASE_URL}/${ITEM_ID}`), 'admin')
            .send({ startDate: NEW_START, endDate: NEW_END });

        expect(response.status).toBe(403);
        expect(User.updateOne).not.toHaveBeenCalled();
    });

    it('returns 200 and the new dates', async () => {
        const response = await updateDates();

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            message: 'Borrow list dates updated',
            entry: { item: ITEM_ID, startDate: `${NEW_START}T00:00:00.000Z`, endDate: `${NEW_END}T00:00:00.000Z` }
        });
    });

    it('updates only the matching entry', async () => {
        await updateDates();

        expect(User.updateOne).toHaveBeenCalledTimes(1);
        expect(User.updateOne).toHaveBeenCalledWith(
            { _id: USER_ID, 'borrow_list.item': ITEM_ID },
            { $set: { 'borrow_list.$.startDate': new Date(NEW_START), 'borrow_list.$.endDate': new Date(NEW_END) } }
        );
    });

    it('checks the item is free for the new dates', async () => {
        await updateDates();

        expect(Reservation.findOverlap).toHaveBeenCalledWith(ITEM_ID, new Date(NEW_START), new Date(NEW_END));
    });

    it('returns 404 when the item is not in the borrow list', async () => {
        User.exists.mockResolvedValue(null);

        const response = await updateDates();

        expect(response.status).toBe(404);
        expect(response.body).toEqual({ message: 'Item not in borrow list' });
        expect(Reservation.findOverlap).not.toHaveBeenCalled();
        expect(User.updateOne).not.toHaveBeenCalled();
    });

    it('returns 404 when the entry disappears before the update runs', async () => {
        User.updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });

        const response = await updateDates();

        expect(response.status).toBe(404);
    });

    it('returns 409 when the item is reserved for the new dates', async () => {
        Reservation.findOverlap.mockResolvedValue({ _id: 'RES-00000001' });

        const response = await updateDates();

        expect(response.status).toBe(409);
        expect(response.body).toEqual({ message: 'Item is not available for these dates' });
        expect(User.updateOne).not.toHaveBeenCalled();
    });

    it.each([
        ['an invalid item id', { startDate: NEW_START, endDate: NEW_END }, 'drill'],
        ['an empty body', {}, ITEM_ID],
        ['no end date', { startDate: NEW_START }, ITEM_ID],
        ['an end date before the start date', { startDate: NEW_END, endDate: NEW_START }, ITEM_ID],
        ['the same start and end date', { startDate: NEW_START, endDate: NEW_START }, ITEM_ID],
        ['a start date in the past', { startDate: daysFromNow(-1), endDate: NEW_END }, ITEM_ID],
        ['a date that is not a date', { startDate: 'soon', endDate: NEW_END }, ITEM_ID],
        ['an unknown field', { startDate: NEW_START, endDate: NEW_END, quantity: 2 }, ITEM_ID]
    ])('returns 400 for %s', async (_case, body, itemId) => {
        const response = await updateDates(body, itemId);

        expect(response.status).toBe(400);
        expect(User.exists).not.toHaveBeenCalled();
        expect(User.updateOne).not.toHaveBeenCalled();
    });

    it('returns 500 when the database fails', async () => {
        User.updateOne.mockRejectedValue(new Error('Database unavailable'));

        const response = await updateDates();

        expect(response.status).toBe(500);
        expect(response.body).toEqual({ message: 'Server Error' });
    });
});

describe('GET /api/borrow-list', () => {
    it('returns 200 with the items, their details and dates', async () => {
        const response = await asMember(request(app).get(BASE_URL));

        expect(response.status).toBe(200);
        expect(response.body.borrowList).toHaveLength(1);
        expect(response.body.borrowList[0]).toMatchObject({
            item: { _id: ITEM_ID, name: 'Cordless Drill', depositAmount: 180, pickup: { location: 'Maadi' } },
            startDate: START,
            endDate: END
        });
    });

    it('loads only the item fields the borrow list page needs', async () => {
        await asMember(request(app).get(BASE_URL));

        expect(User.findById).toHaveBeenCalledWith(USER_ID, 'borrow_list', {
            lean: true,
            populate: { path: 'borrow_list.item', select: 'name category photos depositAmount pickup owner archived delivery' }
        });
    });

    it('leaves out items that were deleted after they were added', async () => {
        borrowListUser.borrow_list.push({ item: null, startDate: START, endDate: END });

        const response = await asMember(request(app).get(BASE_URL));

        expect(response.body.borrowList).toHaveLength(1);
    });

    it('returns an empty list when nothing was added', async () => {
        borrowListUser.borrow_list = [];

        const response = await asMember(request(app).get(BASE_URL));

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ borrowList: [] });
    });

    it('returns 500 when the database fails', async () => {
        User.findById.mockImplementation((id, projection) => projection === 'borrow_list'
            ? Promise.reject(new Error('Database unavailable'))
            : findUserById(id));

        const response = await asMember(request(app).get(BASE_URL));

        expect(response.status).toBe(500);
        expect(response.body).toEqual({ message: 'Server Error' });
    });
});

vi.mock('../models/FriendLink.js', () => ({ FriendLink: { find: vi.fn(async () => []) } }));

vi.mock('../models/MembershipTier.js', () => ({ MembershipTier: { find: vi.fn(async () => []) } }));
