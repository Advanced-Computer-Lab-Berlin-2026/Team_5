import { Item } from '../models/Item.js';
import { Reservation } from '../models/Reservation.js';
import { User } from '../models/User.js';
import { Waitlist } from '../models/Waitlist.js';
import { activeTier, WAITLIST_PRIORITY } from './membershipService.js';
import { formatNotificationDate, notify } from './notificationService.js';

export async function promoteWaitlistAfterCancellation(reservation) {
    const now = new Date();
    const item = await Item.findById(reservation.item, { name: 1, owner: 1, flagged: 1, archived: 1 }, { lean: true });
    if (!item || item.archived || item.flagged) return;

    const candidates = await Waitlist.find({
        item: item._id,
        username: { $nin: [item.owner, reservation.borrower] },
        promotedAt: null,
        startDate: { $gte: now, $lt: reservation.endDate },
        endDate: { $gt: reservation.startDate }
    }, null, { lean: true, sort: { createdAt: 1, _id: 1 } });
    if (candidates.length === 0) return;

    const users = await User.find(
        { _id: { $in: [item.owner, ...candidates.map(entry => entry.username)] }, suspended: { $ne: true } },
        { membership: 1 },
        { lean: true }
    );
    const priority = new Map(users.map(user => [user._id, WAITLIST_PRIORITY[activeTier(user.membership, now)]]));
    if (!priority.has(item.owner)) return;

    const eligible = candidates.filter(entry => priority.has(entry.username));
    eligible.sort((a, b) => priority.get(a.username) - priority.get(b.username));

    for (const entry of eligible) {
        if (await Reservation.findOverlap(item._id, entry.startDate, entry.endDate)) continue;
        const claimed = await Waitlist.findOneAndUpdate(
            { _id: entry._id, promotedAt: null },
            { $set: { promotedAt: now } },
            { returnDocument: 'after' }
        );
        // Another cancellation may already have promoted this entry.
        if (!claimed) return;

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
        return;
    }
}
