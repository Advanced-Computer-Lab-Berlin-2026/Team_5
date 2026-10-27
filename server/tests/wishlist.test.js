import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import app from "../app.js";
import { User } from "../models/User.js";
import { ItemListing } from "../models/ItemListing.js";
import { getUserIdFromCookie } from "../getUserIdFromCookieDummy.js"; // <-- change to your real path

vi.mock('../models/User.js', () => ({
    User: { findById: vi.fn(), updateOne: vi.fn() }
}));

// new compared to the wallet file: addToWishlist calls ItemListing.exists
vi.mock('../models/ItemListing.js', () => ({
    ItemListing: { exists: vi.fn() }
}));

vi.mock('../getUserIdFromCookieDummy.js', () => ({
    getUserIdFromCookie: vi.fn()
}));

/**
 * The controller does: await User.findById(userId).select('wishlist').populate('wishlist')
 * Three calls, so three links: findById -> { select }, select -> { populate }, populate -> the user.
 * Only the last link resolves, the other two just hand over the next object.
 */
function mockWishlistQuery(result) {
    const populate = vi.fn().mockResolvedValue(result);
    const select = vi.fn().mockReturnValue({ populate });
    User.findById.mockReturnValue({ select });
    return { select, populate };
}

// has to be a real looking id because mongoose.isValidObjectId is not mocked
const validItemId = '64b7f0c2e4b0a1a2b3c4d5e6';
// check each of these in a node REPL with mongoose.isValidObjectId before trusting them
const invalidItemIds = ['abc', 'not-an-object-id', '123', '64b7f0c2e4b0a1a2b3c4d5eZ'];

beforeEach(() => {
    vi.resetAllMocks();

    // default happy baseline
    getUserIdFromCookie.mockResolvedValue('member123');
    ItemListing.exists.mockResolvedValue({ _id: validItemId });
    User.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    mockWishlistQuery({ wishlist: [] });
});

describe('POST /api/wishlist/:itemId', () => {
    const sendAdd = (itemId = validItemId) => request(app).post(`/api/wishlist/${itemId}`);

    it('returns 200 and adds the item to the wishlist', async () => {
        const response = await sendAdd();

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ message: 'Item added to wishlist' });
        expect(ItemListing.exists).toHaveBeenCalledExactlyOnceWith({ _id: validItemId });
        expect(User.updateOne).toHaveBeenCalledExactlyOnceWith(
            { _id: 'member123' },
            { $addToSet: { wishlist: validItemId } }
        );
    });

    it('returns 401 when the cookie helper finds no user id', async () => {
        getUserIdFromCookie.mockResolvedValue(null);

        const response = await sendAdd();

        expect(response.status).toBe(401);
        expect(ItemListing.exists).not.toHaveBeenCalled();
        expect(User.updateOne).not.toHaveBeenCalled();
    });

    it.each(invalidItemIds)('returns 400 for invalid item id %s', async (itemId) => {
        const response = await sendAdd(itemId);

        expect(response.status).toBe(400);
        expect(ItemListing.exists).not.toHaveBeenCalled();
        expect(User.updateOne).not.toHaveBeenCalled();
    });

    //BOOKMARK: Go forward from here

    it('returns 404 when the item does not exist', async () => {
        ItemListing.exists.mockResolvedValue(null);

        const response = await sendAdd();

        expect(response.status).toBe(404);
        expect(User.updateOne).not.toHaveBeenCalled();
    });

    it('returns 401 when no user matches the update', async () => {
        User.updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });

        const response = await sendAdd();

        expect(response.status).toBe(401);
    });

    it('returns 409 when the item is already in the wishlist', async () => {
        User.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 0 });

        const response = await sendAdd();

        expect(response.status).toBe(409);
    });

    it.each(['exists', 'updateOne'])('returns 500 when %s fails', async (operation) => {
        // two different models, so a lookup instead of User[operation] like in the auth file
        const failing = { exists: ItemListing.exists, updateOne: User.updateOne };
        failing[operation].mockRejectedValue(new Error('Database unavailable'));

        const response = await sendAdd();

        expect(response.status).toBe(500);
        if (operation === 'exists') {
            expect(User.updateOne).not.toHaveBeenCalled();
        }
    });
});

describe('DELETE /api/wishlist/:itemId', () => {
    const sendRemove = (itemId = validItemId) => request(app).delete(`/api/wishlist/${itemId}`);

    it('returns 200 and removes the item from the wishlist', async () => {
        const response = await sendRemove();

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ message: 'Item removed from wishlist' });
        expect(User.updateOne).toHaveBeenCalledExactlyOnceWith(
            { _id: 'member123' },
            { $pull: { wishlist: validItemId } }
        );
    });

    it('returns 401 when the cookie helper finds no user id', async () => {
        getUserIdFromCookie.mockResolvedValue(null);

        const response = await sendRemove();

        expect(response.status).toBe(401);
        expect(User.updateOne).not.toHaveBeenCalled();
    });

    it.each(invalidItemIds)('returns 400 for invalid item id %s', async (itemId) => {
        const response = await sendRemove(itemId);

        expect(response.status).toBe(400);
        expect(User.updateOne).not.toHaveBeenCalled();
    });

    it('returns 404 when the item is not in the wishlist', async () => {
        User.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 0 });

        const response = await sendRemove();

        expect(response.status).toBe(404);
    });

    it('returns 500 when the update fails', async () => {
        User.updateOne.mockRejectedValue(new Error('Database unavailable'));

        const response = await sendRemove();

        expect(response.status).toBe(500);
    });
});

describe('GET /api/wishlist', () => {
    const sendGetWishlist = () => request(app).get('/api/wishlist');

    function expectNoWishlist(response) {
        expect(response.body).not.toHaveProperty('wishlist');
    }

    it('returns 200 with the populated wishlist', async () => {
        const items = [{ _id: validItemId, title: 'Lamp' }];
        const { select, populate } = mockWishlistQuery({ wishlist: items });

        const response = await sendGetWishlist();

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ wishlist: items });
        expect(User.findById).toHaveBeenCalledExactlyOnceWith('member123');
        expect(select).toHaveBeenCalledExactlyOnceWith('wishlist');
        expect(populate).toHaveBeenCalledExactlyOnceWith('wishlist');
    });

    it('returns 200 with an empty wishlist', async () => {
        const response = await sendGetWishlist(); // default baseline already has wishlist: []

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ wishlist: [] });
    });

    it('returns 401 when the cookie helper finds no user id', async () => {
        getUserIdFromCookie.mockResolvedValue(null);

        const response = await sendGetWishlist();

        expect(response.status).toBe(401);
        expect(User.findById).not.toHaveBeenCalled();
        expectNoWishlist(response);
    });

    it('returns 401 when the user does not exist', async () => {
        mockWishlistQuery(null);

        const response = await sendGetWishlist();

        expect(response.status).toBe(401);
        expectNoWishlist(response);
    });

    it('returns 500 when the wishlist lookup fails', async () => {
        const { populate } = mockWishlistQuery(null);
        populate.mockRejectedValue(new Error('Database unavailable'));

        const response = await sendGetWishlist();

        expect(response.status).toBe(500);
        expectNoWishlist(response);
    });
});