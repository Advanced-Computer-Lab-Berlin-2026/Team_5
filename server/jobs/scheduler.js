import cron from 'node-cron';
import { env } from '../config/env.js';
import { runReturnReminderJob } from './returnReminderJob.js';
import { runRenewalReminderJob } from './renewalReminderJob.js';
import { runReservationExpiryJob } from './reservationExpiryJob.js';

export const DEFAULT_RETURN_REMINDER_CRON = '0 9 * * *';
export const DEFAULT_RENEWAL_REMINDER_CRON = '0 9 * * *';
export const RESERVATION_EXPIRY_CRON = '* * * * *';
const BERLIN = 'Europe/Berlin';

// SCRUM-469: in-process runner; vitest sets NODE_ENV=test so we never leave a live timer hanging
export function shouldStartJobs({ nodeEnv = env.nodeEnv, enableJobs = process.env.ENABLE_JOBS } = {}) {
    // vitest sets NODE_ENV=test; ENABLE_JOBS=false turns the cron off in real deploys
    return nodeEnv !== 'test' && enableJobs !== 'false';
}

export function startScheduler({
    schedule = cron.schedule,
    expression = process.env.RETURN_REMINDER_CRON || DEFAULT_RETURN_REMINDER_CRON,
    runJob = runReturnReminderJob,
    renewalExpression = process.env.RENEWAL_REMINDER_CRON || DEFAULT_RENEWAL_REMINDER_CRON,
    runRenewalJob = runRenewalReminderJob,
    runExpiryJob = runReservationExpiryJob
} = {}) {
    if (!shouldStartJobs()) return null;

    // bad RETURN_REMINDER_CRON would throw here — don't take down the api after listen
    try {
        const returnTask = schedule(
            expression,
            () => {
                runJob().catch((error) => console.error('return reminder job failed', error));
            },
            { timezone: BERLIN }
        );
        // SCRUM-387: membership renewal reminders run on their own schedule
        schedule(
            renewalExpression,
            () => {
                runRenewalJob().catch((error) => console.error('renewal reminder job failed', error));
            },
            { timezone: BERLIN }
        );
        schedule(RESERVATION_EXPIRY_CRON, () =>
            runExpiryJob().catch(error => console.error('reservation expiry job failed', error)),
        { noOverlap: true });
        return returnTask;
    } catch (error) {
        console.error('return reminder scheduler failed to start', error);
        return null;
    }
}
