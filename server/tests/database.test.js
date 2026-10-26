import { afterEach, describe, expect, it, vi } from 'vitest';
import Reservation, { BLOCKING_STATUSES } from '../models/Reservation.js';
import Category from '../models/Category.js';
import MembershipTier from '../models/MembershipTier.js';
import PromoCode from '../models/PromoCode.js';
import { User } from '../models/User.js';

// These tests check the schemas directly, so no database connection is needed.
// Only models with custom logic (validators, hooks, statics) are tested here.

// Runs validation and returns the errors keyed by path ({} when valid).
// pre("validate") hooks only run on the async validate(), not validateSync()
const validationErrors = async doc => {
    try {
        await doc.validate();
        return {};
    } catch (err) {
        return err.errors;
    }
};

// Valid documents; tests override only the fields they care about
const reservation = (overrides = {}) => new Reservation({
    item: 'ITEM-1',
    borrower: 'alice',
    lender: 'bob',
    startDate: new Date('2026-11-01'),
    endDate: new Date('2026-11-05'),
    payment: { depositAmount: 50, method: 'card' },
    ...overrides,
});

const user = (overrides = {}) => new User({
    username: 'martin',
    password: 'hashed-password',
    profile: { name: 'Martin', email: 'martin@example.com' },
    ...overrides,
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('Reservation model', () => {
    describe('defaults', () => {
        it('accepts a valid reservation and fills in defaults', async () => {
            const doc = reservation();
            expect(await validationErrors(doc)).toEqual({});
            // _id is generated as RES- followed by 8 hex characters
            expect(doc._id).toMatch(/^RES-[0-9a-f]{8}$/);
            expect(doc.status).toBe('pending');
            expect(doc.payment.lateFee).toBe(0);
        });
    });

    describe('endDate validator', () => {
        it('rejects an endDate before the startDate', async () => {
            const errors = await validationErrors(reservation({ endDate: new Date('2026-10-30') }));
            expect(errors.endDate.message).toBe('endDate must be after startDate');
        });

        // the validator uses >, so a zero-length reservation is invalid
        it('rejects an endDate equal to the startDate', async () => {
            const errors = await validationErrors(reservation({ endDate: new Date('2026-11-01') }));
            expect(errors.endDate).toBeDefined();
        });
    });

    describe('field validation', () => {
        it('rejects unknown statuses and out-of-range ratings', async () => {
            const errors = await validationErrors(reservation({
                status: 'lost',
                reviews: { lenderRating: 6, borrowerRating: 0 },
            }));
            expect(errors.status).toBeDefined();
            expect(errors['reviews.lenderRating']).toBeDefined();
            expect(errors['reviews.borrowerRating']).toBeDefined();
        });

        it('requires deposit amount and payment method', async () => {
            const errors = await validationErrors(reservation({ payment: {} }));
            expect(errors['payment.depositAmount']).toBeDefined();
            expect(errors['payment.method']).toBeDefined();
        });
    });

    describe('findOverlap', () => {
        // findOverlap sends a real query, so we replace findOne and check the filter it builds
        const mockFindOne = () => {
            const query = { session: vi.fn().mockReturnValue('result') };
            vi.spyOn(Reservation, 'findOne').mockReturnValue(query);
            return query;
        };

        it('queries blocking reservations whose dates overlap the range', () => {
            const query = mockFindOne();
            const start = new Date('2026-11-01');
            const end = new Date('2026-11-05');

            expect(Reservation.findOverlap('ITEM-1', start, end)).toBe('result');
            // two ranges overlap when one starts before the other ends and ends after it starts
            expect(Reservation.findOne).toHaveBeenCalledWith({
                item: 'ITEM-1',
                status: { $in: BLOCKING_STATUSES },
                startDate: { $lt: end },
                endDate: { $gt: start },
            });
            // no session given, so it runs outside a transaction
            expect(query.session).toHaveBeenCalledWith(null);
        });

        // completed, cancelled and rejected reservations must not block new bookings
        it('only treats pending, upcoming and active as blocking', () => {
            expect(BLOCKING_STATUSES).toEqual(['pending', 'upcoming', 'active']);
        });

        it('passes the transaction session through', () => {
            const query = mockFindOne();
            const session = { id: 'session-1' };
            Reservation.findOverlap('ITEM-1', new Date(), new Date(), session);
            expect(query.session).toHaveBeenCalledWith(session);
        });
    });
});

describe('Category model', () => {
    describe('_id hook', () => {
        // trim runs before the hook, so the _id has no extra spaces
        it('uses the trimmed name as the _id', async () => {
            const doc = new Category({ name: '  Tools  ' });
            expect(await validationErrors(doc)).toEqual({});
            expect(doc._id).toBe('Tools');
            expect(doc.depositMultiplier).toBe(1);
        });

        it('keeps an explicit _id', async () => {
            const doc = new Category({ _id: 'tools', name: 'Tools' });
            await doc.validate();
            expect(doc._id).toBe('tools');
        });
    });

    describe('field validation', () => {
        it('rejects a deposit multiplier below 1', async () => {
            const errors = await validationErrors(new Category({ name: 'Tools', depositMultiplier: 0.5 }));
            expect(errors.depositMultiplier).toBeDefined();
        });
    });
});

describe('MembershipTier model', () => {
    describe('_id hook', () => {
        it('uses the tier as the _id', async () => {
            const doc = new MembershipTier({ tier: 'Premium' });
            expect(await validationErrors(doc)).toEqual({});
            expect(doc._id).toBe('Premium');
        });

        // the hook runs after defaults are applied, so the _id is Basic too
        it('defaults to the Basic tier', async () => {
            const doc = new MembershipTier({});
            await doc.validate();
            expect(doc._id).toBe('Basic');
        });
    });

    describe('field validation', () => {
        it('rejects unknown tiers and discounts over 100%', async () => {
            const errors = await validationErrors(new MembershipTier({ tier: 'Gold', deposit_discount: 101 }));
            expect(errors.tier).toBeDefined();
            expect(errors.deposit_discount).toBeDefined();
        });
    });
});

describe('PromoCode model', () => {
    describe('_id hook', () => {
        // users can type the code in any case, so it is stored trimmed and uppercase
        it('normalises the code and uses it as the _id', async () => {
            const doc = new PromoCode({ code: '  save10 ', discountPercent: 10 });
            expect(await validationErrors(doc)).toEqual({});
            expect(doc.code).toBe('SAVE10');
            expect(doc._id).toBe('SAVE10');
            expect(doc.active).toBe(true);
        });
    });

    describe('field validation', () => {
        it('rejects discounts outside 1-100', async () => {
            const low = await validationErrors(new PromoCode({ code: 'A', discountPercent: 0 }));
            const high = await validationErrors(new PromoCode({ code: 'B', discountPercent: 101 }));
            expect(low.discountPercent).toBeDefined();
            expect(high.discountPercent).toBeDefined();
        });
    });
});

describe('User model', () => {
    describe('defaults', () => {
        it('uses the username as the _id and fills in defaults', async () => {
            const doc = user();
            expect(await validationErrors(doc)).toEqual({});
            expect(doc._id).toBe('martin');
            expect(doc.role).toBe('member');
            expect(doc.trustScore).toBe(50);
            expect(doc.membership.tier).toBe('Basic');
            expect(doc.verification.status).toBe('none');
        });
    });

    describe('referral code hook', () => {
        // symbols are stripped, then the first 8 characters are uppercased plus a random 4-hex suffix
        it('generates a referral code from the username', async () => {
            const doc = user({ username: 'martin.s_99' });
            await doc.validate();
            expect(doc.referral_code).toMatch(/^MARTINS9-[0-9A-F]{4}$/);
        });

        it('keeps an existing referral code', async () => {
            const doc = user({ referral_code: 'CUSTOM-0001' });
            await doc.validate();
            expect(doc.referral_code).toBe('CUSTOM-0001');
        });
    });

    describe('field validation', () => {
        it('rejects a trust score outside 0-100 and a negative wallet', async () => {
            const errors = await validationErrors(user({ trustScore: 101, wallet: -1 }));
            expect(errors.trustScore).toBeDefined();
            expect(errors.wallet).toBeDefined();
        });
    });

    describe('toJSON', () => {
        // the password hash must never reach the browser
        it('never includes the password hash in JSON', () => {
            const json = user().toJSON();
            expect(json).not.toHaveProperty('password');
            expect(json.username).toBe('martin');
        });
    });
});
