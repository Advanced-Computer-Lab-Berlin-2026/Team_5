import { Reservation } from '../models/index.js';
import { notifyUpcomingReturn } from '../services/notificationService.js';

const BERLIN = 'Europe/Berlin';

// en-CA gives YYYY-MM-DD so mongodb $dateToString can match the berlin calendar day
export function berlinYmd(date = new Date()) {
    return date.toLocaleDateString('en-CA', { timeZone: BERLIN });
}

export function berlinTomorrowYmd(now = new Date()) {
    // add one civil day onto today's berlin ymd so dst doesn't skip or double a date
    const [year, month, day] = berlinYmd(now).split('-').map(Number);
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    return next.toISOString().slice(0, 10);
}

// SCRUM-470: active loans whose endDate falls on berlin tomorrow; notify skips users already reminded
export async function runReturnReminderJob(now = new Date()) {
    const tomorrowYmd = berlinTomorrowYmd(now);

    const reservations = await Reservation.find(
        {
            status: 'active',
            // older docs may omit handover.returnedAt entirely; newer ones store null until return
            $or: [
                { 'handover.returnedAt': null },
                { 'handover.returnedAt': { $exists: false } }
            ],
            $expr: {
                $eq: [
                    { $dateToString: { format: '%Y-%m-%d', date: '$endDate', timezone: BERLIN } },
                    tomorrowYmd
                ]
            }
        },
        { _id: 1, item: 1, borrower: 1, lender: 1, startDate: 1, endDate: 1 },
        { lean: true }
    );

    for (const reservation of reservations) {
        // helper usually swallows errors; keep the catch so a future throw can't abort the whole morning
        try {
            await notifyUpcomingReturn(reservation);
        } catch (error) {
            console.error(`return reminder failed for ${reservation._id}`, error);
        }
    }

    return { tomorrowYmd, count: reservations.length };
}
