import joi from 'joi';
import { Reservation, BLOCKING_STATUSES, User } from '../models/index.js';
import { Waitlist } from '../models/Waitlist.js';
import { datesOverlap, getWaitlistHolds } from './waitlistAvailability.js';

export const availabilityDates = {
    startDate: joi.date().iso(),
    endDate: joi.date().iso().greater(joi.ref('startDate'))
};

export async function getPublicItemFilter() {
    const filter = { archived: false, flagged: { $ne: true } };
    const suspendedOwners = await User.distinct('_id', { suspended: true });
    if (suspendedOwners.length) filter.owner = { $nin: suspendedOwners };
    return filter;
}

export async function findBookedItemIds(startDate, endDate, viewerId) {
    const overlap = { startDate: { $lt: endDate }, endDate: { $gt: startDate } };
    const [booked, queued] = await Promise.all([
        Reservation.distinct('item', { status: { $in: BLOCKING_STATUSES }, ...overlap }),
        Waitlist.distinct('item', overlap)
    ]);
    const blocked = new Set(booked);
    for (const itemId of queued) {
        if (blocked.has(itemId)) continue;
        const holds = await getWaitlistHolds(itemId);
        if (holds.some(hold => hold.username !== viewerId && datesOverlap(hold, { startDate, endDate }))) {
            blocked.add(itemId);
        }
    }
    return [...blocked];
}
