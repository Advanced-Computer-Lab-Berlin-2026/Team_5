import { BLOCKING_STATUSES, Reservation } from '../models/Reservation.js';
import { User } from '../models/User.js';
import { Waitlist } from '../models/Waitlist.js';
import { CheckoutError } from '../utils/CheckoutError.js';
import { getHouseholdWaitlistPriorities } from './membershipService.js';

export function datesOverlap(a, b) {
    return a.startDate < b.endDate && a.endDate > b.startDate;
}

export async function getWaitlistHolds(itemId, { session = null, reservations, owner } = {}) {
    const now = new Date();
    const today = new Date(now.toISOString().slice(0, 10));
    const entries = await Waitlist.find(
        { item: itemId, startDate: { $gte: today }, ...(owner && { username: { $ne: owner } }) },
        null, { lean: true, sort: { createdAt: 1, _id: 1 }, session }
    );
    if (!entries.length) return [];

    const users = await User.find(
        { _id: { $in: entries.map(entry => entry.username) }, suspended: { $ne: true }, role: { $in: ['member', 'lender'] } },
        { membership: 1 }, { lean: true, session }
    );
    const booked = reservations ?? await Reservation.find(
        { item: itemId, status: { $in: BLOCKING_STATUSES }, endDate: { $gt: today } },
        { startDate: 1, endDate: 1 }, { lean: true, session }
    );
    const priorities = await getHouseholdWaitlistPriorities(users, now, session);
    // The database order breaks ties when the stable sort groups entries by tier.
    const ranked = entries.filter(entry => priorities.has(entry.username));
    ranked.sort((a, b) => priorities.get(a.username) - priorities.get(b.username));

    const holds = [];
    for (const entry of ranked) {
        if (!booked.some(range => datesOverlap(entry, range)) && !holds.some(range => datesOverlap(entry, range))) {
            holds.push(entry);
        }
    }
    return holds;
}

export async function checkWaitlistAvailability(item, username, startDate, endDate, session) {
    const holds = await getWaitlistHolds(item._id, { session, owner: item.owner });
    if (holds.some(hold => hold.username !== username && datesOverlap(hold, { startDate, endDate }))) {
        throw new CheckoutError(409, 'WAITLIST_PRIORITY', 'These dates are held for someone ahead in the waitlist.');
    }
}

export function releaseWaitlistEntry(reservation, session) {
    return Waitlist.deleteMany({
        username: reservation.borrower,
        item: reservation.item,
        startDate: { $lt: reservation.endDate },
        endDate: { $gt: reservation.startDate }
    }, { session });
}
