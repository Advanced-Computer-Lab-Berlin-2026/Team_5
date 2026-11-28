import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_RENEWAL_REMINDER_CRON, DEFAULT_RETURN_REMINDER_CRON, RESERVATION_EXPIRY_CRON, shouldStartJobs, startScheduler } from '../jobs/scheduler.js';

vi.mock('../config/env.js', () => ({ env: { nodeEnv: 'development' } }));
vi.mock('../jobs/returnReminderJob.js', () => ({
    runReturnReminderJob: vi.fn()
}));
vi.mock('../jobs/renewalReminderJob.js', () => ({
    runRenewalReminderJob: vi.fn()
}));

beforeEach(async () => {
    vi.resetAllMocks();
    delete process.env.ENABLE_JOBS;
    delete process.env.RETURN_REMINDER_CRON;
    delete process.env.RENEWAL_REMINDER_CRON;
    const { env } = await import('../config/env.js');
    env.nodeEnv = 'development';
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('shouldStartJobs', () => {
    it('stays off in test so vitest never leaves a live timer', () => {
        expect(shouldStartJobs({ nodeEnv: 'test' })).toBe(false);
    });

    it('respects ENABLE_JOBS=false', () => {
        expect(shouldStartJobs({ nodeEnv: 'development', enableJobs: 'false' })).toBe(false);
    });

    it('runs in normal environments', () => {
        expect(shouldStartJobs({ nodeEnv: 'development', enableJobs: undefined })).toBe(true);
    });
});

describe('startScheduler', () => {
    it('registers the return reminder at 09:00 berlin by default', () => {
        const schedule = vi.fn(() => ({ stop: vi.fn() }));

        startScheduler({ schedule });

        expect(schedule).toHaveBeenCalledWith(
            DEFAULT_RETURN_REMINDER_CRON,
            expect.any(Function),
            { timezone: 'Europe/Berlin' }
        );
        expect(DEFAULT_RETURN_REMINDER_CRON).toBe('0 9 * * *');
    });

    it('uses RETURN_REMINDER_CRON when set', () => {
        process.env.RETURN_REMINDER_CRON = '15 8 * * *';
        const schedule = vi.fn(() => ({ stop: vi.fn() }));

        startScheduler({ schedule });

        expect(schedule).toHaveBeenCalledWith('15 8 * * *', expect.any(Function), { timezone: 'Europe/Berlin' });
    });

    it('returns null when ENABLE_JOBS=false', () => {
        process.env.ENABLE_JOBS = 'false';
        const schedule = vi.fn();

        expect(startScheduler({ schedule })).toBeNull();
        expect(schedule).not.toHaveBeenCalled();
    });

    it('returns null when NODE_ENV is test', async () => {
        const { env } = await import('../config/env.js');
        env.nodeEnv = 'test';
        const schedule = vi.fn();

        expect(startScheduler({ schedule })).toBeNull();
        expect(schedule).not.toHaveBeenCalled();
    });

    it('runs the job from the cron callback and logs failures', async () => {
        const runJob = vi.fn().mockResolvedValue({ count: 0 });
        const schedule = vi.fn(() => ({ stop: vi.fn() }));

        startScheduler({ schedule, runJob });
        const tick = schedule.mock.calls[0][1];

        await tick();
        expect(runJob).toHaveBeenCalledTimes(1);

        runJob.mockRejectedValue(new Error('db down'));
        await tick();
        expect(console.error).toHaveBeenCalledWith('return reminder job failed', expect.any(Error));
    });

    // locks in: bad cron must not crash the api boot path
    it('returns null and logs when schedule throws', () => {
        const schedule = vi.fn(() => {
            throw new Error('invalid cron');
        });

        expect(startScheduler({ schedule })).toBeNull();
        expect(console.error).toHaveBeenCalledWith(
            'return reminder scheduler failed to start',
            expect.any(Error)
        );
    });

    // SCRUM-387
    it('also registers the membership renewal reminder at 09:00 berlin by default', () => {
        const schedule = vi.fn(() => ({ stop: vi.fn() }));

        startScheduler({ schedule });

        expect(schedule).toHaveBeenCalledTimes(4);
        expect(schedule).toHaveBeenNthCalledWith(2, DEFAULT_RENEWAL_REMINDER_CRON, expect.any(Function), { timezone: 'Europe/Berlin' });
        expect(DEFAULT_RENEWAL_REMINDER_CRON).toBe('0 9 * * *');
    });

    it('uses RENEWAL_REMINDER_CRON when set', () => {
        process.env.RENEWAL_REMINDER_CRON = '30 7 * * *';
        const schedule = vi.fn(() => ({ stop: vi.fn() }));

        startScheduler({ schedule });

        expect(schedule).toHaveBeenNthCalledWith(2, '30 7 * * *', expect.any(Function), { timezone: 'Europe/Berlin' });
    });

    it('runs the renewal job from its cron callback and logs failures', async () => {
        const runRenewalJob = vi.fn().mockResolvedValue({ count: 0 });
        const schedule = vi.fn(() => ({ stop: vi.fn() }));

        startScheduler({ schedule, runRenewalJob });
        const tick = schedule.mock.calls[1][1];

        await tick();
        expect(runRenewalJob).toHaveBeenCalledTimes(1);

        runRenewalJob.mockRejectedValue(new Error('db down'));
        await tick();
        expect(console.error).toHaveBeenCalledWith('renewal reminder job failed', expect.any(Error));
    });

    it('still returns the return reminder task', () => {
        const returnTask = { name: 'return' };
        const schedule = vi.fn().mockReturnValueOnce(returnTask).mockReturnValueOnce({ name: 'renewal' });

        expect(startScheduler({ schedule })).toBe(returnTask);
    });

    it('runs the expiry job every minute with no overlapping ticks', async () => {
        const runExpiryJob = vi.fn().mockResolvedValue(undefined);
        const schedule = vi.fn();

        startScheduler({ schedule, runExpiryJob });

        expect(schedule).toHaveBeenCalledWith(RESERVATION_EXPIRY_CRON, expect.any(Function), { noOverlap: true });
        await schedule.mock.calls[2][1]();
        expect(runExpiryJob).toHaveBeenCalledOnce();
    });
});
