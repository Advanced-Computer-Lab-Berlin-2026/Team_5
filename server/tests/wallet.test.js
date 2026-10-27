import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import app from "../app.js";
import { User } from "../models/User.js";
import { getUserIdFromCookie } from "../getUserIdFromCookieDummy.js";

vi.mock('../models/User.js', () => ({
    User: {
        findById: vi.fn()
    }
}));


vi.mock('../getUserIdFromCookieDummy.js', () => ({
    getUserIdFromCookie: vi.fn()
}));


function mockWalletQuery(result) {
    const select = vi.fn().mockResolvedValue(result);
    User.findById.mockReturnValue({ select });
    return select;
}

beforeEach(() => {
    vi.resetAllMocks();

    getUserIdFromCookie.mockResolvedValue('member123');
    mockWalletQuery({ wallet: 250 });
});

describe('GET /api/wallet', () => {
    const sendGetWallet = () => request(app).get('/api/wallet');

    function expectNoBalance(response) {
        expect(response.body).not.toHaveProperty('balance');
    }

    it('returns 200 with the wallet balance', async () => {
        const select = mockWalletQuery({ wallet: 250 });

        const response = await sendGetWallet();

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ balance: 250 });
        expect(User.findById).toHaveBeenCalledExactlyOnceWith('member123');
        expect(select).toHaveBeenCalledExactlyOnceWith('wallet');
    });

    it('returns 200 with a balance of 0 (falsy but valid)', async () => {
        mockWalletQuery({ wallet: 0 });

        const response = await sendGetWallet();

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ balance: 0 });
    });

    it('returns 401 when the cookie helper finds no user id', async () => {
        getUserIdFromCookie.mockResolvedValue(null);

        const response = await sendGetWallet();

        expect(response.status).toBe(401);
        expect(User.findById).not.toHaveBeenCalled();
        expectNoBalance(response);
    });

    it('returns 401 when the user does not exist', async () => {
        mockWalletQuery(null);

        const response = await sendGetWallet();

        expect(response.status).toBe(401);
        expect(User.findById).toHaveBeenCalledWith('member123');
        expectNoBalance(response);
    });

    it('returns 500 when the wallet lookup fails', async () => {
        const select = mockWalletQuery(null);
        select.mockRejectedValue(new Error('Database unavailable'));

        const response = await sendGetWallet();

        expect(response.status).toBe(500);
        expectNoBalance(response);
    });
});