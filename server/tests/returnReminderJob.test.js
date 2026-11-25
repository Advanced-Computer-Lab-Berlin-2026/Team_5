import { beforeEach, describe, expect, it, vi } from 'vitest';
import { berlinTomorrowYmd, berlinYmd, runReturnReminderJob } from '../jobs/returnReminderJob.js';
import { Reservation } from '../models/Reservation.js';
import { notifyUpcomingReturn } from '../services/notificationService.js';

vi.mock('../models/Reservation.js', () => ({
    Reservation: { find: vi.fn() }
}));

vi.mock('../services/notificationService.js', () => ({
    notifyUpcomingReturn: vi.fn()
}));

beforeEach(() => {
    vi.resetAllMocks();
    Reservation.find.mockResolvedValue([]);
    notifyUpcomingReturn.mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('berlinTomorrowYmd', () => {
    it('returns the next berlin calendar day from a fixed instant', () => {
        // 07:00 utc is 08:00 berlin in november, so "today" is the 17th and tomorrow the 18th
        expect(berlinYmd(new Date('2026-11-17T07:00:00Z'))).toBe('2026-11-17');
        expect(berlinTomorrowYmd(new Date('2026-11-17T07:00:00Z'))).toBe('2026-11-18');
    });

    // civil-day bump, not +24h — locks dst spring-forward / fall-back behaviour
    it('still advances one calendar day across berlin dst transitions', () => {
        expect(berlinTomorrowYmd(new Date('2026-03-28T12:00:00Z'))).toBe('2026-03-29');
        expect(berlinTomorrowYmd(new Date('2026-10-24T12:00:00Z'))).toBe('2026-10-25');
    });
});

describe('runReturnReminderJob', () => {
    const dueShape = (id) => ({
        _id: id,
        item: 'ITEM-1',
        borrower: 'yara',
        lender: 'martin',
        startDate: new Date('2026-11-10T10:00:00Z'),
        endDate: new Date('2026-11-18T12:00:00Z')
    });

    it('queries active unreturned loans due berlin tomorrow and notifies each', async () => {
        const due = dueShape('RES-1a2b3c4d');
        Reservation.find.mockResolvedValue([due]);

        const now = new Date('2026-11-17T07:00:00Z');
        const result = await runReturnReminderJob(now);

        expect(result).toEqual({ tomorrowYmd: '2026-11-18', count: 1 });
        expect(Reservation.find).toHaveBeenCalledWith(
            {
                status: 'active',
                $or: [
                    { 'handover.returnedAt': null },
                    { 'handover.returnedAt': { $exists: false } }
                ],
                $expr: {
                    $eq: [
                        { $dateToString: { format: '%Y-%m-%d', date: '$endDate', timezone: 'Europe/Berlin' } },
                        '2026-11-18'
                    ]
                }
            },
            { _id: 1, item: 1, borrower: 1, lender: 1, startDate: 1, endDate: 1 },
            { lean: true }
        );
        expect(notifyUpcomingReturn).toHaveBeenCalledWith(due);
    });

    it('notifies every matching reservation', async () => {
        const first = dueShape('RES-aaa');
        const second = dueShape('RES-bbb');
        Reservation.find.mockResolvedValue([first, second]);

        const result = await runReturnReminderJob(new Date('2026-11-17T07:00:00Z'));

        expect(result.count).toBe(2);
        expect(notifyUpcomingReturn).toHaveBeenCalledTimes(2);
        expect(notifyUpcomingReturn).toHaveBeenNthCalledWith(1, first);
        expect(notifyUpcomingReturn).toHaveBeenNthCalledWith(2, second);
    });

    // a throwing helper shouldn't abort the rest of the morning's list
    it('keeps going when one notify throws', async () => {
        const first = dueShape('RES-aaa');
        const second = dueShape('RES-bbb');
        Reservation.find.mockResolvedValue([first, second]);
        notifyUpcomingReturn
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValueOnce(undefined);

        const result = await runReturnReminderJob(new Date('2026-11-17T07:00:00Z'));

        expect(result.count).toBe(2);
        expect(notifyUpcomingReturn).toHaveBeenCalledTimes(2);
        expect(console.error).toHaveBeenCalledWith('return reminder failed for RES-aaa', expect.any(Error));
    });

    it('notifies nothing when no reservations match', async () => {
        const result = await runReturnReminderJob(new Date('2026-11-17T07:00:00Z'));

        expect(result.count).toBe(0);
        expect(notifyUpcomingReturn).not.toHaveBeenCalled();
    });
});
