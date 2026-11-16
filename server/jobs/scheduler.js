import cron from 'node-cron';
import { env } from '../config/env.js';
import { runReturnReminderJob } from './returnReminderJob.js';

export const DEFAULT_RETURN_REMINDER_CRON = '0 9 * * *';
const BERLIN = 'Europe/Berlin';

// SCRUM-469: in-process runner; vitest sets NODE_ENV=test so we never leave a live timer hanging
export function shouldStartJobs({ nodeEnv = env.nodeEnv, enableJobs = process.env.ENABLE_JOBS } = {}) {
    if (nodeEnv === 'test') return false;
    if (enableJobs === 'false') return false;
    return true;
}

export function startScheduler({
    schedule = cron.schedule,
    expression = process.env.RETURN_REMINDER_CRON || DEFAULT_RETURN_REMINDER_CRON,
    runJob = runReturnReminderJob
} = {}) {
    if (!shouldStartJobs()) return null;

    return schedule(
        expression,
        () => {
            runJob().catch((error) => console.error('return reminder job failed', error));
        },
        { timezone: BERLIN }
    );
}
