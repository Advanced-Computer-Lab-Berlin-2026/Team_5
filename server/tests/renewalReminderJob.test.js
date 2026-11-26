import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RENEWAL_REMINDER_DAYS, berlinYmdPlusDays, runRenewalReminderJob } from '../jobs/renewalReminderJob.js';
import { User } from '../models/User.js';
import { notifyMembershipRenewal } from '../services/notificationService.js';

vi.mock('../models/User.js', () => ({ User: { find: vi.fn() } }));
vi.mock('../services/notificationService.js', () => ({ notifyMembershipRenewal: vi.fn() }));

beforeEach(() => {
    vi.resetAllMocks();
    User.find.mockResolvedValue([]);
    notifyMembershipRenewal.mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('berlinYmdPlusDays', () => {
    it('adds days to the berlin calendar day', () => {
        // 07:00 utc is 08:00 berlin in november
        expect(berlinYmdPlusDays(7, new Date('2026-11-26T07:00:00Z'))).toBe('2026-12-03');
    });

    it('uses the berlin day, not the utc day, close to midnight', () => {
        // 23:30 utc on the 30th is already 00:30 berlin on the 1st
        expect(berlinYmdPlusDays(0, new Date('2026-11-30T23:30:00Z'))).toBe('2026-12-01');
    });

    it('rolls over month and year ends', () => {
        expect(berlinYmdPlusDays(7, new Date('2026-12-28T12:00:00Z'))).toBe('2027-01-04');
    });

    it('still adds whole calendar days across berlin dst changes', () => {
        expect(berlinYmdPlusDays(7, new Date('2026-03-25T12:00:00Z'))).toBe('2026-04-01');
        expect(berlinYmdPlusDays(7, new Date('2026-10-22T12:00:00Z'))).toBe('2026-10-29');
    });
});

describe('runRenewalReminderJob', () => {
    const member = (id) => ({ _id: id, membership: { tier: 'Plus', renewalDate: new Date('2026-12-03T10:00:00Z') } });

    it('reminds 7 days before the renewal date', () => {
        expect(RENEWAL_REMINDER_DAYS).toBe(7);
    });

    it('queries paid members renewing on the berlin day 7 days away and notifies each', async () => {
        User.find.mockResolvedValue([member('tata'), member('yara')]);

        const result = await runRenewalReminderJob(new Date('2026-11-26T07:00:00Z'));

        expect(result).toEqual({ renewalYmd: '2026-12-03', count: 2 });
        expect(User.find).toHaveBeenCalledWith(
            {
                'membership.tier': { $in: ['Plus', 'Premium'] },
                $expr: {
                    $eq: [
                        { $dateToString: { format: '%Y-%m-%d', date: '$membership.renewalDate', timezone: 'Europe/Berlin' } },
                        '2026-12-03'
                    ]
                }
            },
            { _id: 1, 'membership.tier': 1, 'membership.renewalDate': 1 },
            { lean: true }
        );
        expect(notifyMembershipRenewal).toHaveBeenCalledTimes(2);
        expect(notifyMembershipRenewal).toHaveBeenCalledWith(expect.objectContaining({ _id: 'tata' }));
        expect(notifyMembershipRenewal).toHaveBeenCalledWith(expect.objectContaining({ _id: 'yara' }));
    });

    it('does nothing when nobody renews that day', async () => {
        const result = await runRenewalReminderJob(new Date('2026-11-26T07:00:00Z'));

        expect(result.count).toBe(0);
        expect(notifyMembershipRenewal).not.toHaveBeenCalled();
    });

    it('keeps going when one reminder throws', async () => {
        User.find.mockResolvedValue([member('tata'), member('yara')]);
        notifyMembershipRenewal.mockRejectedValueOnce(new Error('boom'));

        const result = await runRenewalReminderJob(new Date('2026-11-26T07:00:00Z'));

        expect(result.count).toBe(2);
        expect(notifyMembershipRenewal).toHaveBeenCalledTimes(2);
        expect(console.error).toHaveBeenCalledWith('renewal reminder failed for tata', expect.any(Error));
    });

    it('lets a database failure reach the scheduler, which logs it', async () => {
        User.find.mockRejectedValue(new Error('db down'));

        await expect(runRenewalReminderJob()).rejects.toThrow('db down');
    });
});
