import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { Item } from '../models/index.js';
import { getSignedManualUrl } from '../services/itemManualStorage.js';

vi.mock('../models/Item.js', () => ({
    Item: { findOne: vi.fn() }
}));

vi.mock('../services/itemManualStorage.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        getSignedManualUrl: vi.fn()
    };
});

const SIGNED_URL = 'https://res.cloudinary.com/demo/image/authenticated/s--sig--/v1/item-manuals/ITM-1.pdf';
const owner = { profile: { name: 'Martin' }, suspended: false, trustScore: 50 };

const itemWithManual = {
    _id: 'ITM-1',
    documents: [{ url: 'https://res.cloudinary.com/demo/image/authenticated/v1/item-manuals/ITM-1.pdf' }],
    owner
};

const manual = (id, query) => request(app).get(`/api/items/${id}/manual`).query(query ?? {});

beforeEach(() => {
    vi.resetAllMocks();
    getSignedManualUrl.mockReturnValue(SIGNED_URL);
});

describe('GET /api/items/:id/manual', () => {
    // SCRUM-243: guests can open manuals the same way they open item details — no cookie
    it('redirects to a signed Cloudinary url when the item has a manual', async () => {
        Item.findOne.mockResolvedValue(itemWithManual);

        const response = await manual('ITM-1');

        expect(response.status).toBe(302);
        expect(response.headers.location).toBe(SIGNED_URL);
        expect(getSignedManualUrl).toHaveBeenCalledWith('ITM-1', { download: false });
        expect(Item.findOne).toHaveBeenCalledExactlyOnceWith(
            { _id: 'ITM-1', flagged: { $ne: true } },
            { documents: 1, owner: 1 },
            { lean: true, populate: { path: 'owner', select: 'profile.name suspended trustScore' } }
        );
    });

    it('passes download=true through to the signer', async () => {
        Item.findOne.mockResolvedValue(itemWithManual);

        const response = await manual('ITM-1', { download: 'true' });

        expect(response.status).toBe(302);
        expect(getSignedManualUrl).toHaveBeenCalledWith('ITM-1', { download: true });
    });

    it('returns 404 when the item has no manual', async () => {
        Item.findOne.mockResolvedValue({ ...itemWithManual, documents: [] });

        const response = await manual('ITM-1');

        expect(response.status).toBe(404);
        expect(response.body).toEqual({ message: 'Manual not found' });
        expect(getSignedManualUrl).not.toHaveBeenCalled();
    });

    it('returns 404 when documents is missing', async () => {
        Item.findOne.mockResolvedValue({ _id: 'ITM-1', owner });

        const response = await manual('ITM-1');

        expect(response.status).toBe(404);
        expect(response.body).toEqual({ message: 'Manual not found' });
    });

    it('returns 404 when the item does not exist', async () => {
        Item.findOne.mockResolvedValue(null);

        const response = await manual('ITM-missing');

        expect(response.status).toBe(404);
        expect(response.body).toEqual({ message: 'Item not found' });
        expect(getSignedManualUrl).not.toHaveBeenCalled();
    });

    // same filter as getItem — flagged never reaches the signed redirect
    it('hides flagged items', async () => {
        Item.findOne.mockResolvedValue(null);

        const response = await manual('ITM-flagged');

        expect(response.status).toBe(404);
        expect(Item.findOne.mock.calls[0][0].flagged).toEqual({ $ne: true });
        expect(getSignedManualUrl).not.toHaveBeenCalled();
    });

    it('returns 404 when the owner is suspended', async () => {
        Item.findOne.mockResolvedValue({
            ...itemWithManual,
            owner: { ...owner, suspended: true }
        });

        const response = await manual('ITM-1');

        expect(response.status).toBe(404);
        expect(response.body).toEqual({ message: 'Item not found' });
        expect(getSignedManualUrl).not.toHaveBeenCalled();
    });
});
