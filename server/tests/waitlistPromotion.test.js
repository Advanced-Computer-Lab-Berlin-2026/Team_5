import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Item } from '../models/Item.js';
import { Reservation } from '../models/Reservation.js';
import { User } from '../models/User.js';
import { Waitlist } from '../models/Waitlist.js';
import { notify } from '../services/notificationService.js';
import { promoteWaitlistAfterCancellation } from '../services/waitlistPromotion.js';
import { checkWaitlistAvailability } from '../services/waitlistAvailability.js';

vi.mock('../services/notificationService.js', async (importOriginal) => ({
    ...(await importOriginal()),
    notify: vi.fn()
}));

const startDate = new Date('2035-07-01');
const endDate = new Date('2035-07-05');
const reservation = { _id: 'RES-1', item: 'ITM-1', borrower: 'cancelled', startDate, endDate };
const entries = ['basic', 'plus', 'premium-first', 'premium-second'].map(username => ({
    _id: username, username, startDate, endDate
}));

beforeEach(() => {
    vi.restoreAllMocks();
    notify.mockReset();
    vi.spyOn(Item, 'findById').mockResolvedValue({ _id: 'ITM-1', name: 'Drill', owner: 'lender' });
    vi.spyOn(Waitlist, 'find').mockResolvedValue(entries);
    vi.spyOn(Waitlist, 'findOneAndUpdate').mockResolvedValue({});
    vi.spyOn(User, 'find').mockResolvedValue([
        { _id: 'lender' }, { _id: 'basic' }, { _id: 'plus', membership: { tier: 'Plus' } },
        { _id: 'premium-first', membership: { tier: 'Premium' } },
        { _id: 'premium-second', membership: { tier: 'Premium' } }
    ]);
    vi.spyOn(User, 'exists').mockResolvedValue({ _id: 'lender' });
    vi.spyOn(Reservation, 'find').mockResolvedValue([]);
});

describe('waitlist promotion after cancellation', () => {
    it('promotes one member by tier, then queue order', async () => {
        await promoteWaitlistAfterCancellation(reservation);

        expect(Waitlist.find).toHaveBeenCalledWith(expect.objectContaining({
            item: 'ITM-1', startDate: { $gte: expect.any(Date) }
        }), null, { lean: true, sort: { createdAt: 1, _id: 1 }, session: null });
        expect(Waitlist.findOneAndUpdate).toHaveBeenCalledExactlyOnceWith(
            { _id: 'premium-first', promotedAt: null },
            { $set: { promotedAt: expect.any(Date) } },
            { returnDocument: 'after' }
        );
        expect(notify).toHaveBeenCalledExactlyOnceWith('premium-first', expect.objectContaining({
            type: 'waitlist-available'
        }));
    });

    it('skips a candidate whose full requested dates are still booked', async () => {
        Waitlist.find.mockResolvedValue(entries.map(entry => entry.username === 'premium-first'
            ? { ...entry, startDate: new Date('2035-06-28') }
            : entry));
        Reservation.find.mockResolvedValue([{ startDate: new Date('2035-06-29'), endDate: startDate }]);

        await promoteWaitlistAfterCancellation(reservation);

        expect(notify).toHaveBeenCalledExactlyOnceWith('premium-second', expect.anything());
    });

    it('does not send a duplicate notice after losing the promotion claim', async () => {
        Waitlist.findOneAndUpdate.mockResolvedValue(null);

        await promoteWaitlistAfterCancellation(reservation);

        expect(notify).not.toHaveBeenCalled();
        expect(Waitlist.findOneAndUpdate).toHaveBeenCalledOnce();
    });

    it('holds dates before notification and passes them to the next equal-tier member when the winner leaves', async () => {
        const item = { _id: reservation.item, owner: 'lender' };
        for (const username of ['basic', 'premium-second', 'new-borrower']) {
            await expect(checkWaitlistAvailability(item, username, startDate, endDate))
                .rejects.toMatchObject({ code: 'WAITLIST_PRIORITY' });
        }
        await expect(checkWaitlistAvailability(item, 'premium-first', startDate, endDate)).resolves.toBeUndefined();
        await expect(checkWaitlistAvailability(item, 'basic', new Date('2035-06-30'), startDate)).resolves.toBeUndefined();

        Waitlist.find.mockResolvedValue(entries.filter(entry => entry.username !== 'premium-first'));
        await expect(checkWaitlistAvailability(item, 'premium-second', startDate, endDate)).resolves.toBeUndefined();
        await promoteWaitlistAfterCancellation(reservation);
        expect(notify).toHaveBeenCalledExactlyOnceWith('premium-second', expect.anything());
    });
});

vi.mock('../models/FriendLink.js', () => ({ FriendLink: { find: vi.fn(async () => []) } }));

vi.mock('../models/MembershipTier.js', () => ({ MembershipTier: { find: vi.fn(async () => []) } }));
