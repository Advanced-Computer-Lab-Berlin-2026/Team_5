import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../app.js';
import { Item, User } from '../models/index.js';
import { uploadItemManual, deleteItemManual } from '../services/itemManualStorage.js';
import { env } from '../config/env.js';

vi.mock('../models/User.js', () => ({
    User: { findById: vi.fn() }
}));

vi.mock('../models/Item.js', () => ({
    Item: { findById: vi.fn() }
}));

// Tests never upload real files and do not need the Cloudinary keys.
vi.mock('../services/itemManualStorage.js', () => ({
    uploadItemManual: vi.fn(),
    deleteItemManual: vi.fn()
}));

const URL = '/api/lender/items/ITM-1/manual';
const NEW_URL = 'https://res.cloudinary.com/demo/image/authenticated/v2/item-manuals/ITM-1.pdf';
const lenderToken = jwt.sign({ id: 'lender1', role: 'lender' }, env.jwtSecret, { expiresIn: '15m' });
const memberToken = jwt.sign({ id: 'member1', role: 'member' }, env.jwtSecret, { expiresIn: '15m' });

function fakeItem(overrides = {}) {
    return { _id: 'ITM-1', owner: 'lender1', documents: [], save: vi.fn().mockResolvedValue(), ...overrides };
}

function put(token = lenderToken) {
    return request(app).put(URL).set('Origin', 'http://localhost:3000').set('Cookie', `accessToken=${token}`);
}

// A PUT as the lender with one file attached under the field "manual".
function putManual(name = 'manual.pdf', content = Buffer.from('fake pdf'), token = lenderToken) {
    return put(token).attach('manual', content, name);
}

beforeEach(() => {
    vi.resetAllMocks();
    User.findById.mockResolvedValue({ id: 'lender1', role: 'lender' });
    uploadItemManual.mockResolvedValue({ public_id: 'item-manuals/ITM-1', secure_url: NEW_URL });
    deleteItemManual.mockResolvedValue({ result: 'ok' });
});

describe('PUT /api/lender/items/:id/manual', () => {
    it('returns 401 without a cookie', async () => {
        const response = await request(app).put(URL).set('Origin', 'http://localhost:3000');

        expect(response.status).toBe(401);
        expect(uploadItemManual).not.toHaveBeenCalled();
    });

    it('returns 403 for a member', async () => {
        User.findById.mockResolvedValue({ id: 'member1', role: 'member' });

        const response = await putManual('manual.pdf', Buffer.from('fake pdf'), memberToken);

        expect(response.status).toBe(403);
        expect(uploadItemManual).not.toHaveBeenCalled();
    });

    it('returns 400 when no file is sent', async () => {
        const response = await put();

        expect(response.status).toBe(400);
        expect(Item.findById).not.toHaveBeenCalled();
    });

    it('returns 400 for a file that is not a PDF', async () => {
        const response = await putManual('manual.png');

        expect(response.status).toBe(400);
        expect(response.body.message).toBe('The manual must be a PDF file');
        expect(uploadItemManual).not.toHaveBeenCalled();
    });

    it('returns 400 for a PDF larger than 10 MB', async () => {
        const response = await putManual('manual.pdf', Buffer.alloc(10 * 1024 * 1024 + 1));

        expect(response.status).toBe(400);
        expect(response.body.message).toBe('The manual must be 10 MB or smaller');
        expect(uploadItemManual).not.toHaveBeenCalled();
    });

    it('returns 400 when more than one file is sent', async () => {
        const response = await put().attach('manual', Buffer.from('a'), 'a.pdf').attach('manual', Buffer.from('b'), 'b.pdf');

        expect(response.status).toBe(400);
        expect(uploadItemManual).not.toHaveBeenCalled();
    });

    it('returns 404 when the item does not exist', async () => {
        Item.findById.mockResolvedValue(null);

        const response = await putManual();

        expect(response.status).toBe(404);
        expect(uploadItemManual).not.toHaveBeenCalled();
    });

    it('returns 403 when the item belongs to another lender', async () => {
        Item.findById.mockResolvedValue(fakeItem({ owner: 'someoneElse' }));

        const response = await putManual();

        expect(response.status).toBe(403);
        expect(uploadItemManual).not.toHaveBeenCalled();
    });

    it('uploads the manual under the item id, saves its url, and returns 200', async () => {
        const item = fakeItem();
        Item.findById.mockResolvedValue(item);

        const response = await putManual();

        expect(response.status).toBe(200);
        expect(uploadItemManual).toHaveBeenCalledTimes(1);
        expect(uploadItemManual.mock.calls[0][1]).toBe('ITM-1');
        expect(item.documents).toEqual([{ url: NEW_URL }]);
        expect(item.save).toHaveBeenCalledTimes(1);
        expect(response.body.item.documents).toEqual([{ url: NEW_URL }]);
    });

    it('replaces an existing manual instead of adding a second one', async () => {
        const item = fakeItem({ documents: [{ url: 'https://res.cloudinary.com/demo/image/authenticated/v1/item-manuals/ITM-1.pdf' }] });
        Item.findById.mockResolvedValue(item);

        const response = await putManual();

        expect(response.status).toBe(200);
        expect(item.documents).toEqual([{ url: NEW_URL }]);
    });

    it('removes a brand new manual again when saving the item fails', async () => {
        const item = fakeItem({ save: vi.fn().mockRejectedValue(new Error('Database unavailable')) });
        Item.findById.mockResolvedValue(item);

        const response = await putManual();

        expect(response.status).toBe(500);
        expect(deleteItemManual).toHaveBeenCalledTimes(1);
        expect(deleteItemManual).toHaveBeenCalledWith('ITM-1');
    });

    it('does not delete anything when saving fails for an item that already had a manual', async () => {
        const item = fakeItem({
            documents: [{ url: 'https://res.cloudinary.com/demo/image/authenticated/v1/item-manuals/ITM-1.pdf' }],
            save: vi.fn().mockRejectedValue(new Error('Database unavailable'))
        });
        Item.findById.mockResolvedValue(item);

        const response = await putManual();

        expect(response.status).toBe(500);
        expect(deleteItemManual).not.toHaveBeenCalled();
    });

    it('returns 500 and saves nothing when the upload fails', async () => {
        const item = fakeItem();
        Item.findById.mockResolvedValue(item);
        uploadItemManual.mockRejectedValue(new Error('Cloudinary down'));

        const response = await putManual();

        expect(response.status).toBe(500);
        expect(deleteItemManual).not.toHaveBeenCalled();
        expect(item.save).not.toHaveBeenCalled();
    });

    it('returns 500 when the item lookup fails', async () => {
        Item.findById.mockRejectedValue(new Error('Database unavailable'));

        const response = await putManual();

        expect(response.status).toBe(500);
        expect(uploadItemManual).not.toHaveBeenCalled();
    });
});