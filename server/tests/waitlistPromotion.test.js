import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Item } from '../models/Item.js';
import { Reservation } from '../models/Reservation.js';
import { User } from '../models/User.js';
import { Waitlist } from '../models/Waitlist.js';
import { notify } from '../services/notificationService.js';
import { promoteWaitlistAfterCancellation } from '../services/waitlistPromotion.js';

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
    vi.spyOn(Reservation, 'findOverlap').mockResolvedValue(null);
});

describe('waitlist promotion after cancellation', () => {
    it('promotes one member by tier, then queue order', async () => {
        await promoteWaitlistAfterCancellation(reservation);

        expect(Waitlist.find).toHaveBeenCalledWith(expect.objectContaining({
            item: 'ITM-1', promotedAt: null, startDate: { $gte: expect.any(Date), $lt: endDate },
            endDate: { $gt: startDate }
        }), null, { lean: true, sort: { createdAt: 1, _id: 1 } });
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
        Reservation.findOverlap.mockResolvedValueOnce({ _id: 'RES-2' });

        await promoteWaitlistAfterCancellation(reservation);

        expect(notify).toHaveBeenCalledExactlyOnceWith('premium-second', expect.anything());
    });

    it('does not send a duplicate notice after losing the promotion claim', async () => {
        Waitlist.findOneAndUpdate.mockResolvedValue(null);

        await promoteWaitlistAfterCancellation(reservation);

        expect(notify).not.toHaveBeenCalled();
        expect(Waitlist.findOneAndUpdate).toHaveBeenCalledOnce();
    });
});
