import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { Reservation } from '../models/Reservation.js';
import { User } from '../models/User.js';
import { DamageReport } from '../models/DamageReport.js';
import { Referral } from '../models/Referral.js';
import { Payment } from '../models/Payment.js';
import { requireAuth } from '../middleware/auth.js';
import { computeTrustScore, recalculateTrustScore } from '../services/trustScoreService.js';
import { rewardReferralIfEligible, REFERRAL_CREDIT_AMOUNT } from '../services/referralService.js';

vi.mock('../middleware/auth.js', async (importOriginal) => ({
    ...(await importOriginal()),
    requireAuth: vi.fn()
}));

const ORIGIN = 'http://localhost:3000';
const validResId = 'RES-12345678';

function authenticateAs(id = 'borrower1', role = 'member') {
    requireAuth.mockImplementation((req, res, next) => {
        req.user = { id, role };
        next();
    });
}

beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    authenticateAs();
});

describe('POST /api/reviews/reservations/:reservationId/lender & /borrower', () => {
    it('allows borrower to review lender after a completed reservation (201)', async () => {
        const resDoc = {
            _id: validResId,
            borrower: 'borrower1',
            lender: 'lender1',
            status: 'completed',
            reviews: {},
            save: vi.fn().mockResolvedValue(true)
        };
        vi.spyOn(Reservation, 'findById').mockResolvedValue(resDoc);

        const res = await request(app)
            .post(`/api/reviews/reservations/${validResId}/lender`)
            .set('Origin', ORIGIN)
            .send({ rating: 5, review: 'Great lender!' });

        expect(res.status).toBe(201);
        expect(resDoc.reviews.lenderRating).toBe(5);
        expect(resDoc.reviews.lenderReview).toBe('Great lender!');
        expect(resDoc.save).toHaveBeenCalledOnce();
    });

    it('rejects duplicate lender review with 409', async () => {
        vi.spyOn(Reservation, 'findById').mockResolvedValue({
            _id: validResId,
            borrower: 'borrower1',
            lender: 'lender1',
            status: 'completed',
            reviews: { lenderRating: 5, lenderReview: 'Already reviewed' }
        });

        const res = await request(app)
            .post(`/api/reviews/reservations/${validResId}/lender`)
            .set('Origin', ORIGIN)
            .send({ rating: 4, review: 'Second review' });

        expect(res.status).toBe(409);
    });

    it('allows lender to review borrower after a completed reservation (201)', async () => {
        authenticateAs('lender1', 'lender');
        const resDoc = {
            _id: validResId,
            borrower: 'borrower1',
            lender: 'lender1',
            status: 'completed',
            reviews: {},
            save: vi.fn().mockResolvedValue(true)
        };
        vi.spyOn(Reservation, 'findById').mockResolvedValue(resDoc);

        const res = await request(app)
            .post(`/api/reviews/reservations/${validResId}/borrower`)
            .set('Origin', ORIGIN)
            .send({ rating: 4, review: 'Returned on time!' });

        expect(res.status).toBe(201);
        expect(resDoc.reviews.borrowerRating).toBe(4);
        expect(resDoc.reviews.borrowerReview).toBe('Returned on time!');
    });
});

describe('GET /api/reviews/users/:username & GET /api/reviews/me', () => {
    it('returns a user trust score and past reviews (200)', async () => {
        vi.spyOn(User, 'findById').mockReturnValue({
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    username: 'lender1',
                    role: 'lender',
                    profile: { name: 'Lender One' },
                    trustScore: 72,
                    suspended: false
                })
            })
        });
        vi.spyOn(Reservation, 'find').mockReturnValue({
            sort: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue([
                    {
                        _id: validResId,
                        lender: 'lender1',
                        borrower: 'borrower1',
                        reviews: { lenderRating: 5, lenderReview: 'Awesome!' },
                        updatedAt: new Date('2026-11-10T00:00:00.000Z')
                    }
                ])
            })
        });

        const res = await request(app).get('/api/reviews/users/lender1').set('Origin', ORIGIN);

        expect(res.status).toBe(200);
        expect(res.body.user.trustScore).toBe(72);
        expect(res.body.reviews).toHaveLength(1);
        expect(res.body.reviews[0].rating).toBe(5);
    });

    it('returns reviews given and received for the logged-in user (200)', async () => {
        vi.spyOn(Reservation, 'find').mockReturnValue({
            sort: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue([
                    {
                        _id: validResId,
                        borrower: 'borrower1',
                        lender: 'lender1',
                        reviews: {
                            lenderRating: 5,
                            lenderReview: 'Nice item',
                            borrowerRating: 4,
                            borrowerReview: 'Good borrower'
                        },
                        updatedAt: new Date('2026-11-10T00:00:00.000Z')
                    }
                ])
            })
        });

        const res = await request(app).get('/api/reviews/me').set('Origin', ORIGIN);

        expect(res.status).toBe(200);
        expect(res.body.given).toHaveLength(1);
        expect(res.body.received).toHaveLength(1);
    });
});

describe('Trust Score Recalculation (Req 99)', () => {
    it('computes trust score from completed reservations, on-time rate, and damage reports', () => {
        // 5 completed (+10), 5/5 on-time (+20), 0 damage (0) => 50 + 10 + 20 = 80
        expect(computeTrustScore(5, 5, 5, 0)).toBe(80);
        // 1 completed (+2), 0/1 on-time (0), 2 damage (-30) => 50 + 2 - 30 = 22
        expect(computeTrustScore(1, 0, 1, 2)).toBe(22);
    });

    it('queries history and updates User.trustScore', async () => {
        const lean = vi.fn().mockResolvedValue([
            {
                _id: validResId,
                borrower: 'borrower1',
                lender: 'lender1',
                endDate: new Date('2026-11-10T00:00:00.000Z'),
                handover: { returnedAt: new Date('2026-11-09T00:00:00.000Z') }
            }
        ]);
        const sessionFn = vi.fn().mockReturnValue({ lean });
        const select = vi.fn().mockReturnValue({ session: sessionFn });
        vi.spyOn(Reservation, 'find').mockReturnValue({ select });
        vi.spyOn(DamageReport, 'countDocuments').mockReturnValue({
            session: vi.fn().mockResolvedValue(0)
        });
        const updateUser = vi.spyOn(User, 'updateOne').mockResolvedValue({});

        const score = await recalculateTrustScore('borrower1');

        expect(score).toBe(72); // 50 + 2 (1 completed) + 20 (100% on time)
        expect(updateUser).toHaveBeenCalledWith({ _id: 'borrower1' }, { $set: { trustScore: 72 } }, {});
    });
});

describe('Referrals (Req 100)', () => {
    it('GET /api/referrals/me returns referral code, link, and sent referrals', async () => {
        vi.spyOn(User, 'findById').mockReturnValue({
            select: vi.fn().mockResolvedValue({
                username: 'borrower1',
                referral_code: 'BORROWER-1A2B',
                referredBy: null
            })
        });
        vi.spyOn(Referral, 'find').mockReturnValue({
            sort: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue([])
            })
        });

        const res = await request(app).get('/api/referrals/me').set('Origin', ORIGIN);

        expect(res.status).toBe(200);
        expect(res.body.referralCode).toBe('BORROWER-1A2B');
        expect(res.body.referralLink).toContain('BORROWER-1A2B');
    });

    it('POST /api/referrals/apply links referred user to referrer', async () => {
        vi.spyOn(User, 'findById').mockResolvedValue({ _id: 'borrower1', referredBy: null });
        vi.spyOn(User, 'findOne').mockResolvedValue({ _id: 'friend1', referral_code: 'FRIEND1-9999' });
        vi.spyOn(User, 'updateOne').mockResolvedValue({});
        vi.spyOn(Referral, 'create').mockResolvedValue({
            _id: 'REF-11112222',
            referrer: 'friend1',
            referred: 'borrower1',
            status: 'sent'
        });

        const res = await request(app)
            .post('/api/referrals/apply')
            .set('Origin', ORIGIN)
            .send({ referralCode: 'FRIEND1-9999' });

        expect(res.status).toBe(201);
        expect(User.updateOne).toHaveBeenCalledWith({ _id: 'borrower1' }, { $set: { referredBy: 'friend1' } });
    });

    it('rewardReferralIfEligible credits referrer wallet on first completed reservation', async () => {
        vi.spyOn(Referral, 'findOneAndUpdate').mockResolvedValue({
            _id: 'REF-11112222',
            referrer: 'friend1',
            referred: 'borrower1',
            status: 'converted',
            creditsIssued: REFERRAL_CREDIT_AMOUNT
        });
        const updateUser = vi.spyOn(User, 'updateOne').mockResolvedValue({});
        const createPayment = vi.spyOn(Payment, 'create').mockResolvedValue([{}]);

        const result = await rewardReferralIfEligible('borrower1', validResId);

        expect(result.status).toBe('converted');
        expect(updateUser).toHaveBeenCalledWith(
            { _id: 'friend1' },
            { $inc: { wallet: REFERRAL_CREDIT_AMOUNT } },
            {}
        );
        expect(createPayment).toHaveBeenCalledOnce();
    });
});