import { Item } from '../models/Item.js';
import { User } from '../models/User.js';
import { Waitlist } from '../models/Waitlist.js';
import { datesOverlap, getWaitlistHolds } from './waitlistAvailability.js';
import { formatNotificationDate, notify } from './notificationService.js';

export async function promoteWaitlistAfterCancellation(reservation) {
    return notifyAvailableWaitlistHolders(reservation.item, reservation);
}

export async function notifyAvailableWaitlistHolders(itemId, releasedRange) {
    const now = new Date();
    const item = await Item.findById(itemId, { name: 1, owner: 1, flagged: 1, archived: 1 }, { lean: true });
    if (!item || item.archived || item.flagged) return;

    const holds = await getWaitlistHolds(item._id, { owner: item.owner });
    const available = holds.filter(entry => !entry.promotedAt && (!releasedRange || datesOverlap(entry, releasedRange)));
    if (!available.length || !await User.exists({ _id: item.owner, suspended: { $ne: true } })) return;

    for (const entry of available) {
        const claimed = await Waitlist.findOneAndUpdate(
            { _id: entry._id, promotedAt: null },
            { $set: { promotedAt: now } },
            { returnDocument: 'after' }
        );
        // Another cancellation may already have promoted this entry.
        if (!claimed) continue;

        try {
            await notify(entry.username, {
                type: 'waitlist-available',
                subject: 'An item on your waitlist is available',
                message: `"${item.name}" is available from ${formatNotificationDate(entry.startDate)} to ${formatNotificationDate(entry.endDate)}.`
            });
        } catch (error) {
            await Waitlist.updateOne({ _id: entry._id, promotedAt: now }, { $set: { promotedAt: null } });
            throw error;
        }
    }
}
