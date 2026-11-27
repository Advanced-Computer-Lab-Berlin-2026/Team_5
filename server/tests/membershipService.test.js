import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    MAX_CONCURRENT_RESERVATIONS,
    activeTier,
    applyDiscount,
    getDepositDiscountPercent,
    hasReachedReservationLimit
} from "../services/membershipService.js";
import { User } from "../models/User.js";
import { MembershipTier } from "../models/MembershipTier.js";
import { FriendLink } from "../models/FriendLink.js";
import { Reservation } from "../models/Reservation.js";

vi.mock('../models/User.js', () => ({ User: { find: vi.fn() } }));
vi.mock('../models/MembershipTier.js', () => ({ MembershipTier: { find: vi.fn() } }));
vi.mock('../models/FriendLink.js', () => ({ FriendLink: { find: vi.fn() } }));
vi.mock('../models/Reservation.js', () => ({ Reservation: { countDocuments: vi.fn() } }));

const NOW = new Date('2026-11-26T12:00:00.000Z');
const FUTURE = new Date('2027-06-01T00:00:00.000Z');
const PAST = new Date('2026-06-01T00:00:00.000Z');

const tierRows = [
    { _id: 'Basic', deposit_discount: 0 },
    { _id: 'Plus', deposit_discount: 10 },
    { _id: 'Premium', deposit_discount: 25 }
];

// find(...).lean() resolves to the rows; the tier lookup only returns the tiers it was asked for
function fakeFind(rows) {
    return { lean: vi.fn().mockResolvedValue(rows) };
}

function borrowerOn(tier, renewalDate) {
    return { _id: 'tata', membership: { tier, renewalDate } };
}

beforeEach(() => {
    vi.resetAllMocks();

    FriendLink.find.mockReturnValue(fakeFind([]));
    User.find.mockReturnValue(fakeFind([]));
    MembershipTier.find.mockImplementation((filter) =>
        fakeFind(tierRows.filter((row) => filter._id.$in.includes(row._id)))
    );
    Reservation.countDocuments.mockResolvedValue(0);
});

describe('activeTier', () => {
    it.each([
        ['Basic', undefined, 'Basic'],
        ['Plus', FUTURE, 'Plus'],
        ['Premium', FUTURE, 'Premium'],
        ['Plus', undefined, 'Plus'],
        ['Plus', null, 'Plus'],
        ['Plus', PAST, 'Basic'],
        ['Premium', NOW, 'Basic'],
        ['Gold', FUTURE, 'Basic'],
        [undefined, undefined, 'Basic']
    ])('%s with renewal %s counts as %s', (tier, renewalDate, expected) => {
        expect(activeTier({ tier, renewalDate }, NOW)).toBe(expected);
    });

    it('treats a missing membership as Basic', () => {
        expect(activeTier(undefined, NOW)).toBe('Basic');
    });
});

describe('applyDiscount', () => {
    it.each([
        [100, 0, 100],
        [100, 10, 90],
        [100, 25, 75],
        [100, 100, 0],
        [0, 25, 0],
        [33.33, 25, 25]
    ])('deposit %s with %s%% off is %s', (deposit, percent, expected) => {
        expect(applyDiscount(deposit, percent)).toBe(expected);
    });
});

describe('getDepositDiscountPercent', () => {
    it('gives 0 to a Basic member with no household', async () => {
        expect(await getDepositDiscountPercent(borrowerOn('Basic'), NOW)).toBe(0);
        // no household means no user lookup
        expect(User.find).not.toHaveBeenCalled();
    });

    it.each([['Plus', 10], ['Premium', 25]])('uses the %s tier discount from the database', async (tier, expected) => {
        expect(await getDepositDiscountPercent(borrowerOn(tier, FUTURE), NOW)).toBe(expected);
    });

    it('reads the percentage from the database, not from a fixed number', async () => {
        MembershipTier.find.mockReturnValue(fakeFind([{ _id: 'Plus', deposit_discount: 15 }]));

        expect(await getDepositDiscountPercent(borrowerOn('Plus', FUTURE), NOW)).toBe(15);
    });

    it('gives 0 when the paid tier has expired', async () => {
        expect(await getDepositDiscountPercent(borrowerOn('Premium', PAST), NOW)).toBe(0);
    });

    it('gives a Basic member the discount of an accepted household member, whoever sent the request', async () => {
        FriendLink.find.mockReturnValue(fakeFind([
            { requester: 'tata', recipient: 'mom' },
            { requester: 'sis', recipient: 'tata' }
        ]));
        User.find.mockReturnValue(fakeFind([
            { _id: 'mom', membership: { tier: 'Plus', renewalDate: FUTURE } },
            { _id: 'sis', membership: { tier: 'Basic' } }
        ]));

        expect(await getDepositDiscountPercent(borrowerOn('Basic'), NOW)).toBe(10);

        expect(FriendLink.find.mock.calls[0][0]).toEqual({
            status: 'accepted',
            $or: [{ requester: 'tata' }, { recipient: 'tata' }]
        });
        expect(User.find.mock.calls[0][0]).toEqual({ _id: { $in: ['mom', 'sis'] } });
    });

    it('takes the best discount between the own tier and the household', async () => {
        FriendLink.find.mockReturnValue(fakeFind([{ requester: 'tata', recipient: 'mom' }]));
        User.find.mockReturnValue(fakeFind([{ _id: 'mom', membership: { tier: 'Premium', renewalDate: FUTURE } }]));

        expect(await getDepositDiscountPercent(borrowerOn('Plus', FUTURE), NOW)).toBe(25);
    });

    it('ignores a household member whose subscription has expired', async () => {
        FriendLink.find.mockReturnValue(fakeFind([{ requester: 'tata', recipient: 'mom' }]));
        User.find.mockReturnValue(fakeFind([{ _id: 'mom', membership: { tier: 'Premium', renewalDate: PAST } }]));

        expect(await getDepositDiscountPercent(borrowerOn('Basic'), NOW)).toBe(0);
    });

    it('only looks at accepted links', async () => {
        await getDepositDiscountPercent(borrowerOn('Basic'), NOW);

        expect(FriendLink.find.mock.calls[0][0].status).toBe('accepted');
    });
});

describe('hasReachedReservationLimit', () => {
    it('has the limits we chose, with Premium at 5 as the ticket says', () => {
        expect(MAX_CONCURRENT_RESERVATIONS).toEqual({ Basic: 2, Plus: 3, Premium: 5 });
    });

    it.each([
        ['Basic', 1, false, 2],
        ['Basic', 2, true, 2],
        ['Plus', 2, false, 3],
        ['Plus', 3, true, 3],
        ['Premium', 4, false, 5],
        ['Premium', 5, true, 5]
    ])('%s with %s open reservations: reached = %s (limit %s)', async (tier, open, reached, limit) => {
        Reservation.countDocuments.mockResolvedValue(open);

        const result = await hasReachedReservationLimit(borrowerOn(tier, FUTURE), undefined, NOW);

        expect(result).toEqual({ reached, limit, tier });
    });

    it('uses the Basic limit once a paid tier has expired', async () => {
        Reservation.countDocuments.mockResolvedValue(2);

        const result = await hasReachedReservationLimit(borrowerOn('Premium', PAST), undefined, NOW);

        expect(result).toEqual({ reached: true, limit: 2, tier: 'Basic' });
    });

    it('counts upcoming and active reservations, and pending ones only while their start date is still ahead, inside the session', async () => {
        const session = { id: 'session' };

        await hasReachedReservationLimit(borrowerOn('Basic'), session, NOW);

        expect(Reservation.countDocuments).toHaveBeenCalledExactlyOnceWith(
            {
                borrower: 'tata',
                $or: [
                    { status: { $in: ['upcoming', 'active'] } },
                    { status: 'pending', startDate: { $gt: NOW } }
                ]
            },
            { session }
        );
    });
});
