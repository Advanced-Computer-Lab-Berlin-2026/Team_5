import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import app from "../app.js";
import { MembershipTier } from "../models/MembershipTier.js";
import { requireAuth } from "../middleware/auth.js";

vi.mock('../models/MembershipTier.js', () => ({
    MembershipTier: { find: vi.fn() }
}));

// replace only requireAuth, keep requireRole real so the role check is tested too
vi.mock('../middleware/auth.js', async (importOriginal) => ({
    ...(await importOriginal()),
    requireAuth: vi.fn()
}));

const TRUSTED_ORIGIN = 'http://localhost:3000';
const URL = '/api/membership-tiers';

const tiers = [
    { _id: 'Basic', tier: 'Basic', annual_fee: 0, deposit_discount: 0, createdAt: new Date(), updatedAt: new Date() },
    { _id: 'Plus', tier: 'Plus', annual_fee: 150, deposit_discount: 10, createdAt: new Date(), updatedAt: new Date() },
    { _id: 'Premium', tier: 'Premium', annual_fee: 300, deposit_discount: 20, createdAt: new Date(), updatedAt: new Date() }
];

function authenticateAs(id = 'member123', role = 'member') {
    requireAuth.mockImplementation((req, res, next) => {
        req.user = { id, role };
        next();
    });
}

function rejectAuth() {
    requireAuth.mockImplementation((req, res) =>
        res.status(401).json({ message: 'Authentication required' })
    );
}

// MembershipTier.find().sort().lean()
function mockTierQuery(result) {
    const query = { sort: vi.fn(), lean: vi.fn().mockResolvedValue(result) };
    query.sort.mockReturnValue(query);
    MembershipTier.find.mockReturnValue(query);
    return query;
}

const sendGetTiers = () => request(app).get(URL).set('Origin', TRUSTED_ORIGIN);

beforeEach(() => {
    vi.resetAllMocks();

    authenticateAs();
    mockTierQuery(tiers);
});

describe('GET /api/membership-tiers', () => {
    it('returns 200 with every tier and only its public fields', async () => {
        const response = await sendGetTiers();

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            tiers: [
                { tier: 'Basic', annual_fee: 0, deposit_discount: 0 },
                { tier: 'Plus', annual_fee: 150, deposit_discount: 10 },
                { tier: 'Premium', annual_fee: 300, deposit_discount: 20 }
            ]
        });
    });

    it('asks the database for the tiers sorted by the cheapest fee first', async () => {
        const query = mockTierQuery(tiers);

        await sendGetTiers();

        expect(MembershipTier.find).toHaveBeenCalledOnce();
        expect(query.sort).toHaveBeenCalledExactlyOnceWith({ annual_fee: 1 });
    });

    it('returns 200 with an empty list when there are no tiers', async () => {
        mockTierQuery([]);

        const response = await sendGetTiers();

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ tiers: [] });
    });

    it('lets lenders see the tiers too', async () => {
        authenticateAs('lender123', 'lender');

        const response = await sendGetTiers();

        expect(response.status).toBe(200);
    });

    it('returns 401 when the request is not authenticated', async () => {
        rejectAuth();

        const response = await sendGetTiers();

        expect(response.status).toBe(401);
        expect(MembershipTier.find).not.toHaveBeenCalled();
        expect(response.body).not.toHaveProperty('tiers');
    });

    it('returns 403 for an admin', async () => {
        authenticateAs('admin1', 'admin');

        const response = await sendGetTiers();

        expect(response.status).toBe(403);
        expect(MembershipTier.find).not.toHaveBeenCalled();
        expect(response.body).not.toHaveProperty('tiers');
    });

    it('returns 500 when the database fails', async () => {
        const query = mockTierQuery(null);
        query.lean.mockRejectedValue(new Error('Database unavailable'));

        const response = await sendGetTiers();

        expect(response.status).toBe(500);
        expect(response.body).not.toHaveProperty('tiers');
    });
});
