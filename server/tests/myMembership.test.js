import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import app from "../app.js";
import { User } from "../models/User.js";
import { requireAuth } from "../middleware/auth.js";

vi.mock('../models/User.js', () => ({
    User: {
        findById: vi.fn()
    }
}));

// replace only requireAuth, keep requireRole real so the role check is tested too
vi.mock('../middleware/auth.js', async (importOriginal) => ({
    ...(await importOriginal()),
    requireAuth: vi.fn()
}));

const TRUSTED_ORIGIN = 'http://localhost:3000';
const URL = '/api/membership';

const START = new Date('2026-02-01T10:00:00.000Z');
const RENEWAL = new Date('2027-02-01T10:00:00.000Z');

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

// User.findById().select('membership')
function mockMembershipQuery(result) {
    const select = vi.fn().mockResolvedValue(result);
    User.findById.mockReturnValue({ select });
    return select;
}

const sendGetMembership = () => request(app).get(URL).set('Origin', TRUSTED_ORIGIN);

beforeEach(() => {
    vi.resetAllMocks();

    authenticateAs();
    mockMembershipQuery({ membership: { tier: 'Plus', startDate: START, renewalDate: RENEWAL } });
});

describe('GET /api/membership', () => {
    it('returns 200 with the tier, start date and renewal date', async () => {
        const select = mockMembershipQuery({ membership: { tier: 'Plus', startDate: START, renewalDate: RENEWAL } });

        const response = await sendGetMembership();

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            membership: {
                tier: 'Plus',
                startDate: START.toISOString(),
                renewalDate: RENEWAL.toISOString()
            }
        });
        expect(User.findById).toHaveBeenCalledExactlyOnceWith('member123');
        expect(select).toHaveBeenCalledExactlyOnceWith('membership');
    });

    it('uses the id of the logged-in user, not anything from the request', async () => {
        authenticateAs('lender456', 'lender');

        const response = await request(app)
            .get(`${URL}?id=someoneElse`)
            .set('Origin', TRUSTED_ORIGIN);

        expect(response.status).toBe(200);
        expect(User.findById).toHaveBeenCalledExactlyOnceWith('lender456');
    });

    it('uses one year after the start date when an older user has no renewal date', async () => {
        mockMembershipQuery({ membership: { tier: 'Basic', startDate: START } });

        const response = await sendGetMembership();

        expect(response.status).toBe(200);
        expect(response.body.membership.tier).toBe('Basic');
        expect(response.body.membership.renewalDate).toBe(RENEWAL.toISOString());
    });

    it('returns a null renewal date when there is no start date to count from', async () => {
        mockMembershipQuery({ membership: { tier: 'Basic' } });

        const response = await sendGetMembership();

        expect(response.status).toBe(200);
        expect(response.body.membership.renewalDate).toBeNull();
    });

    it('returns 401 when the request is not authenticated', async () => {
        rejectAuth();

        const response = await sendGetMembership();

        expect(response.status).toBe(401);
        expect(User.findById).not.toHaveBeenCalled();
        expect(response.body).not.toHaveProperty('membership');
    });

    it('returns 403 for an admin', async () => {
        authenticateAs('admin1', 'admin');

        const response = await sendGetMembership();

        expect(response.status).toBe(403);
        expect(User.findById).not.toHaveBeenCalled();
        expect(response.body).not.toHaveProperty('membership');
    });

    it('returns 401 when the user does not exist', async () => {
        mockMembershipQuery(null);

        const response = await sendGetMembership();

        expect(response.status).toBe(401);
        expect(response.body).not.toHaveProperty('membership');
    });

    it('returns 500 when the lookup fails', async () => {
        const select = mockMembershipQuery(null);
        select.mockRejectedValue(new Error('Database unavailable'));

        const response = await sendGetMembership();

        expect(response.status).toBe(500);
        expect(response.body).not.toHaveProperty('membership');
    });
});
