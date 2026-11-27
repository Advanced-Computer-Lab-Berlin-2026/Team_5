import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../app.js';
import { env } from '../config/env.js';
import { Referral } from '../models/Referral.js';
import { User } from '../models/User.js';

const url = '/api/admin/reports/referrals';

function asRole(role) {
    vi.spyOn(User, 'findById').mockResolvedValue({ role, suspended: false });
    const token = jwt.sign({ id: 'report-test-user' }, env.jwtSecret, { expiresIn: '1m' });
    return request(app).get(url).set('Cookie', `accessToken=${token}`);
}

describe('GET /api/admin/reports/referrals', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.spyOn(Referral, 'aggregate').mockResolvedValue([]);
    });

    it('requires authentication', async () => {
        const response = await request(app).get(url);

        expect(response.status).toBe(401);
        expect(Referral.aggregate).not.toHaveBeenCalled();
    });

    it.each(['member', 'lender'])('denies access to a %s', async (role) => {
        const response = await asRole(role);

        expect(response.status).toBe(403);
        expect(Referral.aggregate).not.toHaveBeenCalled();
    });

    it('counts converted referrals in the sent total and sums their recorded credits', async () => {
        Referral.aggregate.mockResolvedValue([{ referralsSent: 3, referralsConverted: 2, creditsIssued: 125 }]);

        const response = await asRole('admin');

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ summary: { referralsSent: 3, referralsConverted: 2, creditsIssued: 125 } });
        const [pipeline] = Referral.aggregate.mock.calls[0];
        expect(pipeline[0]).toEqual({ $match: { status: { $in: ['sent', 'converted'] } } });
        expect(pipeline[1].$group).toMatchObject({
            referralsSent: { $sum: 1 },
            referralsConverted: { $sum: { $cond: [{ $eq: ['$status', 'converted'] }, 1, 0] } },
            creditsIssued: { $sum: { $cond: [{ $eq: ['$status', 'converted'] }, '$creditsIssued', 0] } }
        });
    });

    it('returns zero totals when there are no referrals', async () => {
        const response = await asRole('admin');

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ summary: { referralsSent: 0, referralsConverted: 0, creditsIssued: 0 } });
    });

    it('returns 500 when the database query fails', async () => {
        Referral.aggregate.mockRejectedValue(new Error('Database unavailable'));

        const response = await asRole('admin');

        expect(response.status).toBe(500);
        expect(response.body).toEqual({ message: 'Server Error' });
    });
});
