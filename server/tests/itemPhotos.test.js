import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../app.js';
import { Item, User } from '../models/index.js';
import { uploadItemPhoto, deleteItemPhoto } from '../services/itemPhotoStorage.js';
import { env } from '../config/env.js';

vi.mock('../models/User.js', () => ({
    User: { findById: vi.fn() }
}));

vi.mock('../models/Item.js', () => ({
    Item: { findById: vi.fn() }
}));

// Tests never upload real files and do not need the Cloudinary keys.
vi.mock('../services/itemPhotoStorage.js', () => ({
    uploadItemPhoto: vi.fn(),
    deleteItemPhoto: vi.fn()
}));

const URL = '/api/lender/items/ITM-1/photos';
const lenderToken = jwt.sign({ id: 'lender1', role: 'lender' }, env.jwtSecret, { expiresIn: '15m' });
const memberToken = jwt.sign({ id: 'member1', role: 'member' }, env.jwtSecret, { expiresIn: '15m' });

function fakeItem(overrides = {}) {
    return { _id: 'ITM-1', owner: 'lender1', photos: [], save: vi.fn().mockResolvedValue(), ...overrides };
}

// A POST as the lender with the given photo file names attached under the field "photos".
function postPhotos(names, token = lenderToken) {
    const req = request(app).post(URL).set('Origin', 'http://localhost:3000').set('Cookie', `accessToken=${token}`);
    names.forEach((name) => req.attach('photos', Buffer.from('fake image'), name));
    return req;
}

beforeEach(() => {
    vi.resetAllMocks();
    User.findById.mockResolvedValue({ id: 'lender1', role: 'lender' });
    let count = 0;
    uploadItemPhoto.mockImplementation(async () => {
        count += 1;
        return { public_id: `item-photos/p${count}`, secure_url: `https://res.cloudinary.com/demo/item-photos/p${count}.jpg` };
    });
    deleteItemPhoto.mockResolvedValue({ result: 'ok' });
});

describe('POST /api/lender/items/:id/photos', () => {
    it('returns 401 without a cookie', async () => {
        const response = await request(app).post(URL).set('Origin', 'http://localhost:3000');

        expect(response.status).toBe(401);
        expect(uploadItemPhoto).not.toHaveBeenCalled();
    });

    it('returns 403 for a member', async () => {
        User.findById.mockResolvedValue({ id: 'member1', role: 'member' });

        const response = await postPhotos(['a.jpg'], memberToken);

        expect(response.status).toBe(403);
        expect(uploadItemPhoto).not.toHaveBeenCalled();
    });

    it('returns 400 when no photo is sent', async () => {
        const response = await request(app).post(URL).set('Origin', 'http://localhost:3000').set('Cookie', `accessToken=${lenderToken}`);

        expect(response.status).toBe(400);
        expect(Item.findById).not.toHaveBeenCalled();
    });

    it('returns 400 for a file that is not JPEG, JPG or PNG', async () => {
        const response = await postPhotos(['manual.pdf']);

        expect(response.status).toBe(400);
        expect(response.body.message).toBe('Only JPEG, JPG and PNG photos are allowed');
        expect(uploadItemPhoto).not.toHaveBeenCalled();
    });

    it('returns 400 when more photos than allowed are sent in one request', async () => {
        const response = await postPhotos(['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg', '6.jpg']);

        expect(response.status).toBe(400);
        expect(uploadItemPhoto).not.toHaveBeenCalled();
    });

    it('returns 404 when the item does not exist', async () => {
        Item.findById.mockResolvedValue(null);

        const response = await postPhotos(['a.jpg']);

        expect(response.status).toBe(404);
        expect(uploadItemPhoto).not.toHaveBeenCalled();
    });

    it('returns 403 when the item belongs to another lender', async () => {
        Item.findById.mockResolvedValue(fakeItem({ owner: 'someoneElse' }));

        const response = await postPhotos(['a.jpg']);

        expect(response.status).toBe(403);
        expect(uploadItemPhoto).not.toHaveBeenCalled();
    });

    it('returns 400 when the item would end up with too many photos', async () => {
        const existing = [1, 2, 3, 4].map((n) => ({ url: `https://x/${n}.jpg` }));
        Item.findById.mockResolvedValue(fakeItem({ photos: existing }));

        const response = await postPhotos(['a.jpg', 'b.jpg']);

        expect(response.status).toBe(400);
        expect(uploadItemPhoto).not.toHaveBeenCalled();
    });

    it('uploads the photos and saves their urls, and returns 200', async () => {
        const item = fakeItem();
        Item.findById.mockResolvedValue(item);

        const response = await postPhotos(['a.jpg', 'b.png']);

        expect(response.status).toBe(200);
        expect(uploadItemPhoto).toHaveBeenCalledTimes(2);
        expect(item.photos).toEqual([
            { url: 'https://res.cloudinary.com/demo/item-photos/p1.jpg' },
            { url: 'https://res.cloudinary.com/demo/item-photos/p2.jpg' }
        ]);
        expect(item.save).toHaveBeenCalledTimes(1);
        expect(response.body.item.photos).toHaveLength(2);
    });

    it('removes the uploaded files again when saving the item fails', async () => {
        const item = fakeItem({ save: vi.fn().mockRejectedValue(new Error('Database unavailable')) });
        Item.findById.mockResolvedValue(item);

        const response = await postPhotos(['a.jpg', 'b.jpg']);

        expect(response.status).toBe(500);
        expect(deleteItemPhoto).toHaveBeenCalledTimes(2);
        expect(deleteItemPhoto).toHaveBeenCalledWith('item-photos/p1');
        expect(deleteItemPhoto).toHaveBeenCalledWith('item-photos/p2');
    });

    it('removes the photos that did upload when another upload fails, and saves nothing', async () => {
        const item = fakeItem();
        Item.findById.mockResolvedValue(item);
        uploadItemPhoto.mockReset();
        uploadItemPhoto
            .mockResolvedValueOnce({ public_id: 'item-photos/ok', secure_url: 'https://res.cloudinary.com/demo/item-photos/ok.jpg' })
            .mockRejectedValueOnce(new Error('Cloudinary down'));

        const response = await postPhotos(['a.jpg', 'b.jpg']);

        expect(response.status).toBe(500);
        expect(deleteItemPhoto).toHaveBeenCalledTimes(1);
        expect(deleteItemPhoto).toHaveBeenCalledWith('item-photos/ok');
        expect(item.save).not.toHaveBeenCalled();
    });

    it('returns 500 when the item lookup fails', async () => {
        Item.findById.mockRejectedValue(new Error('Database unavailable'));

        const response = await postPhotos(['a.jpg']);

        expect(response.status).toBe(500);
        expect(uploadItemPhoto).not.toHaveBeenCalled();
    });
});