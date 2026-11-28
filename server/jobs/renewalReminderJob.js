import { User } from '../models/User.js';
import { notifyMembershipRenewal } from '../services/notificationService.js';
import { berlinYmd } from './returnReminderJob.js';

const BERLIN = 'Europe/Berlin';

// how many days before the renewal date the member is reminded
export const RENEWAL_REMINDER_DAYS = 7;

// same civil-day trick as the return reminder, so a dst change can't skip or double a date
export function berlinYmdPlusDays(days, now = new Date()) {
    const [year, month, day] = berlinYmd(now).split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

// SCRUM-387: paid members whose renewalDate falls on the berlin day 7 days from now; notify skips members already reminded
export async function runRenewalReminderJob(now = new Date()) {
    const renewalYmd = berlinYmdPlusDays(RENEWAL_REMINDER_DAYS, now);

    const users = await User.find(
        {
            'membership.tier': { $exists: true, $nin: ['Basic', null] },
            $expr: {
                $eq: [
                    { $dateToString: { format: '%Y-%m-%d', date: '$membership.renewalDate', timezone: BERLIN } },
                    renewalYmd
                ]
            }
        },
        { _id: 1, 'membership.tier': 1, 'membership.renewalDate': 1 },
        { lean: true }
    );

    for (const user of users) {
        // the helper catches its own errors, the catch keeps one bad user from stopping the rest
        try {
            await notifyMembershipRenewal(user);
        } catch (error) {
            console.error(`renewal reminder failed for ${user._id}`, error);
        }
    }

    return { renewalYmd, count: users.length };
}
