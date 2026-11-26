import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import app from "../app.js";
import { User } from "../models/User.js";
import { MembershipTier } from "../models/MembershipTier.js";
import { requireAuth } from "../middleware/auth.js";

vi.mock('../models/User.js', () => ({
    User: { findOneAndUpdate: vi.fn() }
}));

vi.mock('../models/MembershipTier.js', () => ({
    MembershipTier: { findById: vi.fn() }
}));

// replace only requireAuth, keep requireRole real so the role checks are tested too
vi.mock('../middleware/auth.js', async (importOriginal) => ({
    ...(await importOriginal()),
    requireAuth: vi.fn()
}));

const ORIGIN = 'http://localhost:3000';
const SUBSCRIBE_URL = '/api/membership/subscribe';
const CANCEL_URL = '/api/membership/cancel';

const tiers = {
    Plus: { tier: 'Plus', annual_fee: 300, deposit_discount: 10 },
    Premium: { tier: 'Premium', annual_fee: 800, deposit_discount: 25 }
};

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

function mockTierLookup(result) {
    const lean = vi.fn().mockResolvedValue(result);
    MembershipTier.findById.mockReturnValue({ lean });
}

// findOneAndUpdate(...).select('membership') resolves to the updated user (or null if no row matched)
function mockUpdate(result) {
    const select = vi.fn().mockResolvedValue(result);
    User.findOneAndUpdate.mockReturnValue({ select });
    return select;
}

function failUpdate() {
    const select = vi.fn().mockRejectedValue(new Error('Database unavailable'));
    User.findOneAndUpdate.mockReturnValue({ select });
}

const post = (url) => request(app).post(url).set('Origin', ORIGIN);

beforeEach(() => {
    vi.resetAllMocks();

    authenticateAs();
    mockTierLookup(tiers.Plus);
    mockUpdate({ membership: { tier: 'Plus' } });
});

describe('POST /api/membership/subscribe', () => {
    it('returns 200, sets the tier and a renewal date one year after the start date', async () => {
        const response = await post(SUBSCRIBE_URL).send({ tier: 'Plus' });

        expect(response.status).toBe(200);
        expect(response.body.message).toBe('Subscribed to Plus');
        expect(response.body.tier).toEqual(tiers.Plus);

        const [filter, update, options] = User.findOneAndUpdate.mock.calls[0];
        const { 'membership.tier': tier, 'membership.startDate': startDate, 'membership.renewalDate': renewalDate } = update.$set;

        expect(MembershipTier.findById).toHaveBeenCalledExactlyOnceWith('Plus');
        expect(tier).toBe('Plus');
        expect(startDate).toBeInstanceOf(Date);
        expect(renewalDate.getTime()).toBe(new Date(startDate).setUTCFullYear(startDate.getUTCFullYear() + 1));
        expect(options).toEqual({ returnDocument: 'after' });
        // only updates a user who is not already on this tier
        expect(filter).toEqual({ _id: 'member123', 'membership.tier': { $ne: 'Plus' } });
    });

    it('works for Premium and for lenders', async () => {
        authenticateAs('lender1', 'lender');
        mockTierLookup(tiers.Premium);
        mockUpdate({ membership: { tier: 'Premium' } });

        const response = await post(SUBSCRIBE_URL).send({ tier: 'Premium' });

        expect(response.status).toBe(200);
        expect(response.body.tier).toEqual(tiers.Premium);
        expect(User.findOneAndUpdate.mock.calls[0][0]._id).toBe('lender1');
    });

    it('returns the updated membership in the response', async () => {
        const membership = { tier: 'Plus', startDate: '2026-11-26T10:00:00.000Z', renewalDate: '2027-11-26T10:00:00.000Z' };
        mockUpdate({ membership });

        const response = await post(SUBSCRIBE_URL).send({ tier: 'Plus' });

        expect(response.body.membership).toEqual(membership);
    });

    it.each([
        ['Basic', { tier: 'Basic' }],
        ['an unknown tier', { tier: 'Gold' }],
        ['a lowercase tier', { tier: 'plus' }],
        ['a missing tier', {}],
        ['a non-string tier', { tier: 5 }]
    ])('returns 400 for %s', async (_name, body) => {
        const response = await post(SUBSCRIBE_URL).send(body);

        expect(response.status).toBe(400);
        expect(MembershipTier.findById).not.toHaveBeenCalled();
        expect(User.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('returns 400 when there is no body at all', async () => {
        const response = await post(SUBSCRIBE_URL);

        expect(response.status).toBe(400);
        expect(User.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('returns 404 when the tier is missing from the database', async () => {
        mockTierLookup(null);

        const response = await post(SUBSCRIBE_URL).send({ tier: 'Plus' });

        expect(response.status).toBe(404);
        expect(User.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('returns 409 when the member is already on that tier', async () => {
        mockUpdate(null);

        const response = await post(SUBSCRIBE_URL).send({ tier: 'Plus' });

        expect(response.status).toBe(409);
        expect(response.body.message).toBe('You are already subscribed to Plus');
    });

    it('returns 401 when the request is not authenticated', async () => {
        rejectAuth();

        const response = await post(SUBSCRIBE_URL).send({ tier: 'Plus' });

        expect(response.status).toBe(401);
        expect(User.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('returns 403 for admins', async () => {
        authenticateAs('admin1', 'admin');

        const response = await post(SUBSCRIBE_URL).send({ tier: 'Plus' });

        expect(response.status).toBe(403);
        expect(User.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('returns 403 without a trusted origin (CSRF)', async () => {
        const response = await request(app).post(SUBSCRIBE_URL).send({ tier: 'Plus' });

        expect(response.status).toBe(403);
        expect(User.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('returns 500 with a general message when the database fails', async () => {
        failUpdate();

        const response = await post(SUBSCRIBE_URL).send({ tier: 'Plus' });

        expect(response.status).toBe(500);
        expect(response.body).toEqual({ message: 'Server Error' });
    });
});

describe('POST /api/membership/cancel', () => {
    beforeEach(() => {
        mockUpdate({ membership: { tier: 'Basic', renewalDate: null } });
    });

    it('returns 200 and puts the member back on Basic immediately with no renewal date', async () => {
        const response = await post(CANCEL_URL);

        expect(response.status).toBe(200);
        expect(response.body.message).toBe('Membership cancelled. You are back on Basic');
        expect(response.body.membership).toEqual({ tier: 'Basic', renewalDate: null });

        const [filter, update, options] = User.findOneAndUpdate.mock.calls[0];

        expect(update.$set['membership.tier']).toBe('Basic');
        expect(update.$set['membership.renewalDate']).toBeNull();
        expect(update.$set['membership.startDate']).toBeInstanceOf(Date);
        expect(options).toEqual({ returnDocument: 'after' });
        // only updates a user who is on a paid tier
        expect(filter).toEqual({ _id: 'member123', 'membership.tier': { $in: ['Plus', 'Premium'] } });
    });

    it('works for lenders', async () => {
        authenticateAs('lender1', 'lender');

        const response = await post(CANCEL_URL);

        expect(response.status).toBe(200);
        expect(User.findOneAndUpdate.mock.calls[0][0]._id).toBe('lender1');
    });

    it('returns 409 when the member is already on Basic', async () => {
        mockUpdate(null);

        const response = await post(CANCEL_URL);

        expect(response.status).toBe(409);
        expect(response.body.message).toBe('You have no paid membership to cancel');
    });

    it('returns 401 when the request is not authenticated', async () => {
        rejectAuth();

        const response = await post(CANCEL_URL);

        expect(response.status).toBe(401);
        expect(User.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('returns 403 for admins', async () => {
        authenticateAs('admin1', 'admin');

        const response = await post(CANCEL_URL);

        expect(response.status).toBe(403);
        expect(User.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('returns 403 without a trusted origin (CSRF)', async () => {
        const response = await request(app).post(CANCEL_URL);

        expect(response.status).toBe(403);
        expect(User.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('returns 500 with a general message when the database fails', async () => {
        failUpdate();

        const response = await post(CANCEL_URL);

        expect(response.status).toBe(500);
        expect(response.body).toEqual({ message: 'Server Error' });
    });
});
