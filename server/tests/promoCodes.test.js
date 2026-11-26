import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../app.js';
import { env } from '../config/env.js';
import { Item } from '../models/Item.js';
import { PromoCode } from '../models/PromoCode.js';
import { PromoCodeUsage } from '../models/PromoCodeUsage.js';
import { User } from '../models/User.js';

vi.mock('../models/Item.js', () => ({ Item: { findOne: vi.fn() } }));
vi.mock('../models/PromoCode.js', () => ({ PromoCode: { findOne: vi.fn(), find: vi.fn(), create: vi.fn() } }));
vi.mock('../models/PromoCodeUsage.js', () => ({ PromoCodeUsage: { countDocuments: vi.fn(), find: vi.fn(), aggregate: vi.fn() } }));
vi.mock('../models/User.js', () => ({ User: { findById: vi.fn() } }));

const ORIGIN = 'http://localhost:3000';
const token = (id) => jwt.sign({ id }, env.jwtSecret, { expiresIn: '15m' });
const item = { _id: 'ITM-1', depositAmount: 80 };
const promoCode = { _id: 'SAVE20', code: 'SAVE20', discountPercent: 20, minimumDeposit: 50, active: true };

function cookieFor(id, role) {
    User.findById.mockResolvedValue({ _id: id, role, suspended: false });
    return `accessToken=${token(id)}`;
}

function applyPromo(cookie, body = { code: 'save20', itemId: 'ITM-1' }) {
    return request(app).post('/api/promo-codes/validate')
        .set('Origin', ORIGIN)
        .set('Cookie', cookie)
        .send(body);
}

beforeEach(() => {
    vi.resetAllMocks();
    Item.findOne.mockResolvedValue(item);
    PromoCode.findOne.mockResolvedValue(promoCode);
    PromoCodeUsage.countDocuments.mockResolvedValue(0);
});

describe('POST /api/promo-codes/validate', () => {
    it('returns a deposit quote with the promo discount applied', async () => {
        const cookie = cookieFor('member1', 'member');

        const response = await applyPromo(cookie);

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            code: 'SAVE20',
            discountPercent: 20,
            minimumDeposit: 50,
            originalDeposit: 80,
            discountAmount: 16,
            discountedDeposit: 64,
        });
        expect(Item.findOne).toHaveBeenCalledWith({ _id: 'ITM-1', archived: false, flagged: { $ne: true } });
        expect(PromoCode.findOne).toHaveBeenCalledWith({ code: 'SAVE20' });
    });

    it('rejects invalid input', async () => {
        const cookie = cookieFor('member1', 'member');

        const response = await applyPromo(cookie, { code: '', itemId: 'ITM-1' });

        expect(response.status).toBe(400);
        expect(PromoCode.findOne).not.toHaveBeenCalled();
    });

    it('returns 404 for a missing or hidden item', async () => {
        const cookie = cookieFor('member1', 'member');
        Item.findOne.mockResolvedValue(null);

        const response = await applyPromo(cookie);

        expect(response.status).toBe(404);
        expect(PromoCode.findOne).not.toHaveBeenCalled();
    });

    it('rejects deposits below the promo minimum', async () => {
        const cookie = cookieFor('member1', 'member');
        PromoCode.findOne.mockResolvedValue({ ...promoCode, minimumDeposit: 100 });

        const response = await applyPromo(cookie);

        expect(response.status).toBe(400);
        expect(response.body.message).toBe('Deposit does not meet the promo code minimum');
    });

    it.each([
        [null, 'Promo code is invalid or inactive'],
        [{ ...promoCode, active: false }, 'Promo code is invalid or inactive'],
        [{ ...promoCode, expiresAt: new Date(Date.now() - 1000) }, 'Promo code has expired'],
    ])('rejects an invalid or expired code', async (code, message) => {
        const cookie = cookieFor('member1', 'member');
        PromoCode.findOne.mockResolvedValue(code);

        const response = await applyPromo(cookie);

        expect(response.status).toBe(400);
        expect(response.body.message).toBe(message);
    });

    it('rejects a code whose global usage limit has been reached', async () => {
        const cookie = cookieFor('member1', 'member');
        PromoCode.findOne.mockResolvedValue({ ...promoCode, maxUses: 3 });
        PromoCodeUsage.countDocuments.mockResolvedValue(3);

        const response = await applyPromo(cookie);

        expect(response.status).toBe(400);
        expect(response.body.message).toBe('Promo code usage limit has been reached');
        expect(PromoCodeUsage.countDocuments).toHaveBeenCalledWith({ code: 'SAVE20' });
    });

    it('allows only members to apply promo codes', async () => {
        const cookie = cookieFor('admin1', 'admin');

        const response = await applyPromo(cookie);

        expect(response.status).toBe(403);
        expect(PromoCode.findOne).not.toHaveBeenCalled();
    });
});

describe('POST /api/admin/promo-codes', () => {
    it('creates a normalized active promo code', async () => {
        const cookie = cookieFor('admin1', 'admin');
        PromoCode.create.mockResolvedValue({ ...promoCode });

        const response = await request(app).post('/api/admin/promo-codes')
            .set('Origin', ORIGIN).set('Cookie', cookie)
            .send({ code: ' save20 ', discountPercent: 20, maxUses: 30 });

        expect(response.status).toBe(201);
        expect(PromoCode.create).toHaveBeenCalledWith({
            code: 'SAVE20', discountPercent: 20, maxUses: 30, minimumDeposit: 0, active: true,
        });
    });

    it('rejects invalid discount and usage limits', async () => {
        const cookie = cookieFor('admin1', 'admin');

        const response = await request(app).post('/api/admin/promo-codes')
            .set('Origin', ORIGIN).set('Cookie', cookie)
            .send({ code: 'SAVE20', discountPercent: 101, maxUses: 0 });

        expect(response.status).toBe(400);
        expect(PromoCode.create).not.toHaveBeenCalled();
    });

    it('returns conflict when the code already exists', async () => {
        const cookie = cookieFor('admin1', 'admin');
        PromoCode.create.mockRejectedValue({ code: 11000 });

        const response = await request(app).post('/api/admin/promo-codes')
            .set('Origin', ORIGIN).set('Cookie', cookie)
            .send({ code: 'SAVE20', discountPercent: 20 });

        expect(response.status).toBe(409);
        expect(response.body.message).toBe('Promo code already exists');
    });

    it('allows only admins to create promo codes', async () => {
        const cookie = cookieFor('member1', 'member');

        const response = await request(app).post('/api/admin/promo-codes')
            .set('Origin', ORIGIN).set('Cookie', cookie)
            .send({ code: 'SAVE20', discountPercent: 20 });

        expect(response.status).toBe(403);
        expect(PromoCode.create).not.toHaveBeenCalled();
    });
});

describe('GET /api/admin/promo-codes/usage', () => {
    it('returns redemption details and per-code totals for the requested period', async () => {
        const cookie = cookieFor('admin1', 'admin');
        const redemptions = [
            { code: { code: 'SAVE20' }, user: { username: 'member1' }, discountAmount: 10 },
            { code: { code: 'SAVE20' }, user: { username: 'member2' }, discountAmount: 15 },
        ];
        const query = {
            sort: vi.fn(),
            populate: vi.fn(),
            lean: vi.fn().mockResolvedValue(redemptions),
        };
        query.sort.mockReturnValue(query);
        query.populate.mockReturnValue(query);
        PromoCodeUsage.find.mockReturnValue(query);

        const response = await request(app).get('/api/admin/promo-codes/usage')
            .query({ code: 'save20', from: '2026-01-01', to: '2026-12-31' })
            .set('Cookie', cookie);

        expect(response.status).toBe(200);
        expect(response.body.totalRedemptions).toBe(2);
        expect(response.body.totalDiscountIssued).toBe(25);
        expect(response.body.summary).toEqual([{ code: 'SAVE20', redemptions: 2, discountIssued: 25 }]);
        expect(response.body.redemptions).toHaveLength(2);
        expect(PromoCodeUsage.find).toHaveBeenCalledWith({
            code: 'SAVE20',
            date: { $gte: new Date('2026-01-01'), $lte: new Date('2026-12-31') },
        });
        expect(query.populate).toHaveBeenCalledTimes(4);
    });

    it('rejects an invalid date range', async () => {
        const cookie = cookieFor('admin1', 'admin');

        const response = await request(app).get('/api/admin/promo-codes/usage')
            .query({ from: '2026-12-31', to: '2026-01-01' })
            .set('Cookie', cookie);

        expect(response.status).toBe(400);
        expect(PromoCodeUsage.find).not.toHaveBeenCalled();
    });
});

describe('GET /api/admin/promo-codes', () => {
    it('lists all codes with redemption counts and derived status', async () => {
        const cookie = cookieFor('admin1', 'admin');
        const promoCodes = [
            { _id: 'ACTIVE', code: 'ACTIVE', active: true },
            { _id: 'EXPIRED', code: 'EXPIRED', active: true, expiresAt: new Date('2020-01-01') },
            { _id: 'USED', code: 'USED', active: true, maxUses: 2 },
            { _id: 'OFF', code: 'OFF', active: false },
        ];
        const query = { sort: vi.fn(), lean: vi.fn().mockResolvedValue(promoCodes) };
        query.sort.mockReturnValue(query);
        PromoCode.find.mockReturnValue(query);
        PromoCodeUsage.aggregate.mockResolvedValue([{ _id: 'USED', redemptions: 2 }]);

        const response = await request(app).get('/api/admin/promo-codes').set('Cookie', cookie);

        expect(response.status).toBe(200);
        expect(response.body.promoCodes.map(({ code, redemptionCount, status }) => ({ code, redemptionCount, status })))
            .toEqual([
                { code: 'ACTIVE', redemptionCount: 0, status: 'active' },
                { code: 'EXPIRED', redemptionCount: 0, status: 'expired' },
                { code: 'USED', redemptionCount: 2, status: 'usage-limit-reached' },
                { code: 'OFF', redemptionCount: 0, status: 'inactive' },
            ]);
    });
});