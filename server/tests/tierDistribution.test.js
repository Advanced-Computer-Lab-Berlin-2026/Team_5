import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../app.js";
import { env } from "../config/env.js";
import { User } from "../models/User.js";
import { MembershipTier } from "../models/MembershipTier.js";

vi.mock('../models/User.js', () => ({
    User: { findById: vi.fn(), aggregate: vi.fn() }
}));

vi.mock('../models/MembershipTier.js', () => ({
    MembershipTier: { find: vi.fn() }
}));

const ADMIN_ID = 'admin1';
const BASE_URL = '/api/admin/reports/membership-tiers';
const ORIGIN = 'http://localhost:3000';

const tiers = [
    { tier: 'Basic', annual_fee: 0, deposit_discount: 0 },
    { tier: 'Plus', annual_fee: 150, deposit_discount: 10 },
    { tier: 'Premium', annual_fee: 300, deposit_discount: 20 }
];

let loggedInRole;

function findUserById(id) {
    return Promise.resolve(id === ADMIN_ID ? { _id: ADMIN_ID, role: loggedInRole, suspended: false } : null);
}

function loginCookie(role) {
    loggedInRole = role;
    return `accessToken=${jwt.sign({ id: ADMIN_ID, role }, env.jwtSecret, { expiresIn: '15m' })}`;
}

function asAdmin(req) {
    return req.set('Cookie', loginCookie('admin')).set('Origin', ORIGIN);
}

function fakeQuery(result) {
    const query = { sort: vi.fn(), lean: vi.fn().mockResolvedValue(result) };
    query.sort.mockReturnValue(query);
    return query;
}

function findTier(response, name) {
    return response.body.tiers.find((tier) => tier.tier === name);
}

beforeEach(() => {
    vi.resetAllMocks();

    User.findById.mockImplementation(findUserById);
    MembershipTier.find.mockReturnValue(fakeQuery(tiers));
    User.aggregate.mockResolvedValue([{ _id: 'Basic', members: 6 }, { _id: 'Plus', members: 2 }]);
});

describe('Admin access', () => {
    it('returns 401 when not logged in', async () => {
        const response = await request(app).get(BASE_URL);

        expect(response.status).toBe(401);
    });

    it.each(['member', 'lender'])('returns 403 when the user is a %s', async (role) => {
        const response = await request(app)
            .get(BASE_URL)
            .set('Cookie', loginCookie(role));

        expect(response.status).toBe(403);
        expect(User.aggregate).not.toHaveBeenCalled();
    });
});

describe('GET /api/admin/reports/membership-tiers', () => {
    it('returns 200 with the number and percentage of members in each tier', async () => {
        const response = await asAdmin(request(app).get(BASE_URL));

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            totalMembers: 8,
            tiers: [
                { tier: 'Basic', annualFee: 0, depositDiscount: 0, members: 6, percentage: 75 },
                { tier: 'Plus', annualFee: 150, depositDiscount: 10, members: 2, percentage: 25 },
                { tier: 'Premium', annualFee: 300, depositDiscount: 20, members: 0, percentage: 0 }
            ]
        });
    });

    it('lists the tiers from the cheapest to the most expensive', async () => {
        await asAdmin(request(app).get(BASE_URL));

        expect(MembershipTier.find.mock.results[0].value.sort).toHaveBeenCalledWith({ annual_fee: 1 });
    });

    it('counts members and lenders but not admins, and treats a missing tier as Basic', async () => {
        await asAdmin(request(app).get(BASE_URL));

        const [pipeline] = User.aggregate.mock.calls[0];
        expect(pipeline[0]).toEqual({ $match: { role: { $in: ['member', 'lender'] } } });
        expect(pipeline[1].$group._id).toEqual({ $ifNull: ['$membership.tier', 'Basic'] });
    });

    it('rounds the percentage to one decimal', async () => {
        User.aggregate.mockResolvedValue([{ _id: 'Basic', members: 2 }, { _id: 'Premium', members: 1 }]);

        const response = await asAdmin(request(app).get(BASE_URL));

        expect(findTier(response, 'Basic').percentage).toBe(66.7);
        expect(findTier(response, 'Premium').percentage).toBe(33.3);
    });

    it('still counts members whose tier is no longer in the tiers collection', async () => {
        User.aggregate.mockResolvedValue([{ _id: 'Basic', members: 3 }, { _id: 'Gold', members: 1 }]);

        const response = await asAdmin(request(app).get(BASE_URL));

        expect(response.body.totalMembers).toBe(4);
        expect(findTier(response, 'Gold')).toEqual({ tier: 'Gold', annualFee: null, depositDiscount: null, members: 1, percentage: 25 });
    });

    it('returns 0% for every tier when there are no members', async () => {
        User.aggregate.mockResolvedValue([]);

        const response = await asAdmin(request(app).get(BASE_URL));

        expect(response.status).toBe(200);
        expect(response.body.totalMembers).toBe(0);
        expect(response.body.tiers.map((tier) => tier.percentage)).toEqual([0, 0, 0]);
    });

    it('returns 500 when the database fails', async () => {
        User.aggregate.mockRejectedValue(new Error('Database unavailable'));

        const response = await asAdmin(request(app).get(BASE_URL));

        expect(response.status).toBe(500);
        expect(response.body).toEqual({ message: 'Server Error' });
    });
});
