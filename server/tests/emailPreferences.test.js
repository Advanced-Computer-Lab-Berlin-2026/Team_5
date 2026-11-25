import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { User } from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';
import { normalizeEmailPreferences } from '../utils/emailPreferences.js';

vi.mock('../models/User.js', () => ({
    User: { findById: vi.fn(), findByIdAndUpdate: vi.fn() }
}));

vi.mock('../middleware/auth.js', async (importOriginal) => ({
    ...(await importOriginal()),
    requireAuth: vi.fn()
}));

const TRUSTED_ORIGIN = 'http://localhost:3000';
const defaults = { reservations: true, promotions: true, communityNotices: true };

// same rule GET/PATCH and emailUser share
describe('normalizeEmailPreferences', () => {
    it('fills missing keys with true', () => {
        expect(normalizeEmailPreferences({ reservations: false })).toEqual({
            reservations: false,
            promotions: true,
            communityNotices: true
        });
    });

    it('treats nullish prefs as all on', () => {
        expect(normalizeEmailPreferences(null)).toEqual(defaults);
        expect(normalizeEmailPreferences()).toEqual(defaults);
    });
});

function authenticateAs(id = 'yara', role = 'member') {
    requireAuth.mockImplementation((req, res, next) => {
        req.user = { id, role };
        next();
    });
}

function rejectAuth() {
    requireAuth.mockImplementation((req, res) => res.status(401).json({ message: 'Authentication required' }));
}

beforeEach(() => {
    vi.resetAllMocks();
    authenticateAs();
    User.findById.mockResolvedValue({ _id: 'yara', emailPreferences: defaults });
    User.findByIdAndUpdate.mockResolvedValue({
        _id: 'yara',
        emailPreferences: { ...defaults, promotions: false }
    });
});

describe('GET /api/settings/email-preferences', () => {
    it('returns the member switches', async () => {
        const res = await request(app).get('/api/settings/email-preferences');

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ emailPreferences: defaults });
        expect(User.findById).toHaveBeenCalledWith('yara', { emailPreferences: 1 }, { lean: true });
    });

    // old users may have no emailPreferences subdoc yet — treat missing as on
    it('fills in true when preferences are missing', async () => {
        User.findById.mockResolvedValue({ _id: 'yara' });

        const res = await request(app).get('/api/settings/email-preferences');

        expect(res.status).toBe(200);
        expect(res.body.emailPreferences).toEqual(defaults);
    });

    it('returns 401 when the user no longer exists', async () => {
        User.findById.mockResolvedValue(null);

        const res = await request(app).get('/api/settings/email-preferences');

        expect(res.status).toBe(401);
        expect(res.body).toEqual({ message: 'User not found' });
    });

    it.each(['findById'])('returns 500 when %s fails', async (operation) => {
        User[operation].mockRejectedValue(new Error('Database unavailable'));

        const res = await request(app).get('/api/settings/email-preferences');

        expect(res.status).toBe(500);
    });

    it('needs a login', async () => {
        rejectAuth();

        const res = await request(app).get('/api/settings/email-preferences');

        expect(res.status).toBe(401);
        expect(User.findById).not.toHaveBeenCalled();
    });

    it('rejects admins like the profile route', async () => {
        authenticateAs('admin', 'admin');

        const res = await request(app).get('/api/settings/email-preferences');

        expect(res.status).toBe(403);
        expect(User.findById).not.toHaveBeenCalled();
    });

    it('lets lenders read their switches', async () => {
        authenticateAs('martin', 'lender');

        const res = await request(app).get('/api/settings/email-preferences');

        expect(res.status).toBe(200);
        expect(User.findById).toHaveBeenCalledWith('martin', { emailPreferences: 1 }, { lean: true });
    });
});

describe('PATCH /api/settings/email-preferences', () => {
    const patch = (body) =>
        request(app)
            .patch('/api/settings/email-preferences')
            .set('Origin', TRUSTED_ORIGIN)
            .send(body);

    it('updates only the fields sent', async () => {
        const res = await patch({ promotions: false });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            message: 'Email preferences updated',
            emailPreferences: { ...defaults, promotions: false }
        });
        expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
            'yara',
            { $set: { 'emailPreferences.promotions': false } },
            { new: true, runValidators: true, lean: true, projection: { emailPreferences: 1 } }
        );
    });

    it.each([{}, { promotions: 'nope' }, { unknown: true }])(
        'rejects bad body %# with 400',
        async (body) => {
            const res = await patch(body);

            expect(res.status).toBe(400);
            expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
        }
    );

    it('returns 401 when the user no longer exists', async () => {
        User.findByIdAndUpdate.mockResolvedValue(null);

        const res = await patch({ reservations: false });

        expect(res.status).toBe(401);
        expect(res.body).toEqual({ message: 'User not found' });
    });

    it('returns 500 when the database update fails', async () => {
        User.findByIdAndUpdate.mockRejectedValue(new Error('Database unavailable'));

        const res = await patch({ reservations: false });

        expect(res.status).toBe(500);
    });

    it('needs a login', async () => {
        rejectAuth();

        const res = await patch({ reservations: false });

        expect(res.status).toBe(401);
        expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('rejects admins like the profile route', async () => {
        authenticateAs('admin', 'admin');

        const res = await patch({ promotions: false });

        expect(res.status).toBe(403);
        expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('lets lenders update their switches', async () => {
        authenticateAs('martin', 'lender');
        User.findByIdAndUpdate.mockResolvedValue({
            _id: 'martin',
            emailPreferences: { ...defaults, reservations: false }
        });

        const res = await patch({ reservations: false });

        expect(res.status).toBe(200);
        expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
            'martin',
            { $set: { 'emailPreferences.reservations': false } },
            { new: true, runValidators: true, lean: true, projection: { emailPreferences: 1 } }
        );
    });

    it('updates every field sent in one request', async () => {
        User.findByIdAndUpdate.mockResolvedValue({
            _id: 'yara',
            emailPreferences: { reservations: false, promotions: false, communityNotices: true }
        });

        const res = await patch({
            reservations: false,
            promotions: false,
            communityNotices: true
        });

        expect(res.status).toBe(200);
        expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
            'yara',
            {
                $set: {
                    'emailPreferences.reservations': false,
                    'emailPreferences.promotions': false,
                    'emailPreferences.communityNotices': true
                }
            },
            { new: true, runValidators: true, lean: true, projection: { emailPreferences: 1 } }
        );
    });
});
