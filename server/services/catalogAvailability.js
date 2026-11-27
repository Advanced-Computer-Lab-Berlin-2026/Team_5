import joi from 'joi';
import { Reservation, BLOCKING_STATUSES, User } from '../models/index.js';

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

export function findBookedItemIds(startDate, endDate) {
    return Reservation.distinct('item', {
        status: { $in: BLOCKING_STATUSES },
        startDate: { $lt: endDate },
        endDate: { $gt: startDate }
    });
}
