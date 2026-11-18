import { Item, Notification, User, Waitlist } from '../models/index.js';
import { sendNotificationEmail } from './emailService.js';
import { env } from '../config/env.js';
import { normalizeEmailPreferences } from '../utils/emailPreferences.js';

// SCRUM-519: which preference switch gates which Notification.type
// promotions has no notification types yet — wire them here when they land
const EMAIL_CATEGORY_BY_TYPE = {
    delivery: 'reservations',
    accepted: 'reservations',
    rejected: 'reservations',
    'upcoming-return-date': 'reservations',
    'renewal-reminder': 'reservations',
    'waitlist-available': 'reservations',
    // wishlist mail uses the reservations switch on purpose (same bucket in settings UI)
    'favourite-available': 'reservations',
    other: 'reservations',
    'community-notice': 'communityNotices'
};

// helpers below call this after commit (not inside withTransaction — retries would double-email).
// catch/log at the call site or a failed save 500s an already-committed booking
export async function notify(username, { type, message, subject, reservation }) {
    // model defaults type to "other" when callers skip it — emailUser uses whatever got saved
    const notification = await Notification.create({ username, type, message, reservation });

    // fire-and-forget so a slow gmail never slows the request; no retry/queue on purpose
    emailUser(notification, subject).catch((error) =>
        console.error(`failed to send email for ${notification._id} to ${username}, the in-app one is saved`, error)
    );
    return notification;
}

// null means send; otherwise the bit after "email skipped for NOT-…, " in the warn line
function prefsSkipReason(notification, emailPreferences) {
    const category = EMAIL_CATEGORY_BY_TYPE[notification.type];
    // new enum values with no map entry skip mail until someone adds them — I don't fail-open on opt-out
    if (notification.type && category === undefined) {
        return `type ${notification.type} isn't in EMAIL_CATEGORY_BY_TYPE yet`;
    }
    const prefs = normalizeEmailPreferences(emailPreferences);
    if (prefs[category] === false) {
        return `${notification.username} turned off ${category}`;
    }
    return null;
}

async function emailUser(notification, subject) {
    if (!env.notifySmtpUser || !env.notifySmtpPass) {
        console.warn(`email skipped for ${notification._id}, NOTIFY_SMTP_USER / NOTIFY_SMTP_PASS aren't set`);
        return;
    }
    // username is the User _id, so findById works here
    const user = await User.findById(
        notification.username,
        { 'profile.email': 1, emailPreferences: 1 },
        { lean: true }
    );
    const email = user?.profile?.email;
    if (!email) {
        console.warn(`email skipped for ${notification._id}, ${notification.username} has no email on file`);
        return;
    }

    // in-app row is already saved; only the gmail respects the category switch
    const skipReason = prefsSkipReason(notification, user.emailPreferences);
    if (skipReason) {
        console.warn(`email skipped for ${notification._id}, ${skipReason}`);
        return;
    }

    await sendNotificationEmail(email, subject ?? 'You have a new ShareShed notification', notification.message);
}

// berlin time, a utc server would show the wrong day for bookings around midnight
const DATE_FORMAT = { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Berlin' };

// string id, or populated { _id } if a teammate forgot to keep the reservation unpopulated
function asItemId(value) {
    if (typeof value === 'string') return value;
    if (value && typeof value._id === 'string') return value._id;
    return null;
}

// quoted name ("Drill") or null when the item is gone — callers fall back to "the item" / "item"
async function itemAndDates({ _id, item: itemRef, startDate, endDate }, label) {
    // findById(undefined) is findOne({}) in mongoose, so a missing id must not pick a random name
    const itemId = asItemId(itemRef);
    const item = itemId
        ? await Item.findById(itemId, { name: 1 }, { lean: true })
        : null;
    if (!item) console.warn(`item ${itemId} not found for ${_id}, sending the ${label} without its name`);
    const format = (date) => date.toLocaleDateString('en-GB', DATE_FORMAT);
    return { name: item && `"${item.name}"`, dates: `from ${format(startDate)} to ${format(endDate)}` };
}

// each side catches so Promise.all doesn't hide the second failure; about defaults to reservation id
function notifyOrLog(username, label, details, about = details.reservation) {
    return notify(username, details)
        .catch((error) => console.error(`failed to save the ${label} for ${about} to ${username}`, error));
}

// caller rule for confirm/cancel/reject: unpopulated status-guarded doc, after commit, only when non-null

// nothing calls this yet — SCRUM-352 approve (pending -> upcoming)
export async function notifyReservationConfirmed(reservation) {
    try {
        const { _id, borrower, lender } = reservation;
        const { name, dates } = await itemAndDates(reservation, 'confirmation');
        const details = { type: 'accepted', subject: 'Reservation confirmed', reservation: _id };
        const borrowerDetails = {
            ...details,
            message: `Your reservation for ${name ?? 'the item'} ${dates} is confirmed`
        };
        // self-lend: one row only — two creates for the same username is just noise
        if (borrower === lender) {
            await notifyOrLog(borrower, 'confirmation', borrowerDetails);
            return;
        }
        await Promise.all([
            notifyOrLog(borrower, 'confirmation', borrowerDetails),
            notifyOrLog(lender, 'confirmation', {
                ...details,
                message: `${borrower}'s reservation for your ${name ?? 'item'} ${dates} is confirmed`
            })
        ]);
    } catch (error) {
        console.error(`failed to send the confirmation for ${reservation?._id}`, error);
    }
}

// nothing calls this yet — SCRUM-351 borrower cancel; wording assumes it was them
export async function notifyReservationCancelled(reservation) {
    try {
        const { _id, borrower, lender } = reservation;
        const { name, dates } = await itemAndDates(reservation, 'cancellation');
        // the notification model has no cancelled type, so I send it as other instead of touching the shared enum
        const details = { type: 'other', subject: 'Reservation cancelled', reservation: _id };
        const borrowerDetails = {
            ...details,
            message: `You cancelled your reservation for ${name ?? 'the item'} ${dates}`
        };
        if (borrower === lender) {
            await notifyOrLog(borrower, 'cancellation', borrowerDetails);
            return;
        }
        await Promise.all([
            notifyOrLog(borrower, 'cancellation', borrowerDetails),
            notifyOrLog(lender, 'cancellation', {
                ...details,
                message: `${borrower} cancelled their reservation for your ${name ?? 'item'} ${dates}`
            })
        ]);
    } catch (error) {
        console.error(`failed to send the cancellation for ${reservation?._id}`, error);
    }
}

// nothing calls this yet — SCRUM-352 lender reject (pending -> rejected)
export async function notifyReservationRejected(reservation) {
    try {
        const { _id, borrower, lender } = reservation;
        const { name, dates } = await itemAndDates(reservation, 'rejection');
        const details = { type: 'rejected', subject: 'Reservation request rejected', reservation: _id };
        const borrowerDetails = {
            ...details,
            message: `${lender} rejected your reservation request for ${name ?? 'their item'} ${dates}`
        };
        if (borrower === lender) {
            await notifyOrLog(borrower, 'rejection', borrowerDetails);
            return;
        }
        await Promise.all([
            notifyOrLog(borrower, 'rejection', borrowerDetails),
            notifyOrLog(lender, 'rejection', {
                ...details,
                message: `You rejected ${borrower}'s reservation request for your ${name ?? 'item'} ${dates}`
            })
        ]);
    } catch (error) {
        console.error(`failed to send the rejection for ${reservation?._id}`, error);
    }
}

// SCRUM-373 / 470: daily job calls this for each active loan due berlin tomorrow
// berlin "by" date here is the same calendar day the job matched with $dateToString
export async function notifyUpcomingReturn(reservation) {
    try {
        const { _id, borrower, lender, endDate } = reservation;
        if (!endDate) {
            console.error(`return reminder skipped for ${_id}, endDate is missing`);
            return;
        }
        const { name } = await itemAndDates(reservation, 'return reminder');
        const due = endDate.toLocaleDateString('en-GB', DATE_FORMAT);
        const details = { type: 'upcoming-return-date', subject: 'Return reminder', reservation: _id };
        // same username twice would race two findOnes and double-create, so self-lend gets one reminder
        if (borrower === lender) {
            await notifyReturnIfNew(borrower, {
                ...details,
                message: `Please return ${name ?? 'the item'} by ${due}`
            });
            return;
        }
        await Promise.all([
            notifyReturnIfNew(borrower, {
                ...details,
                message: `Please return ${name ?? 'the item'} by ${due}`
            }),
            notifyReturnIfNew(lender, {
                ...details,
                message: `${borrower} should return your ${name ?? 'item'} by ${due}`
            })
        ]);
    } catch (error) {
        console.error(`failed to send the return reminder for ${reservation?._id}`, error);
    }
}

export async function notifyDeliveryStatus(reservation, status) {
    if (!reservation?._id || !reservation.borrower) return;
    if (!['out-for-delivery', 'delivered'].includes(status)) return;

    try {
        const itemId = asItemId(reservation.item);
        const item = itemId
            ? await Item.findById(itemId, { name: 1 }, { lean: true })
            : null;
        const name = item?.name ? `"${item.name}"` : 'item';
        const subject = status === 'delivered' ? 'Item delivered' : 'Item out for delivery';
        const message = status === 'delivered'
            ? `Your ${name} has been delivered`
            : `Your ${name} is out for delivery`;

        await notifyOrLog(reservation.borrower, 'delivery status', {
            type: 'delivery',
            subject,
            reservation: reservation._id,
            message
        });
    } catch (error) {
        console.error(`failed to send the delivery status for ${reservation?._id}`, error);
    }
}

// findOne then create — fine for a single cron; overlapping replicas can still race without a unique index
async function notifyReturnIfNew(username, details) {
    const already = await Notification.findOne(
        { username, type: 'upcoming-return-date', reservation: details.reservation },
        { _id: 1 },
        { lean: true }
    );
    if (already) return;
    return notifyOrLog(username, 'return reminder', details);
}

// nothing calls this yet — wire from 237/394/351/352/357/358 after commit; pass item id string once
// itemRef: string id, or populated { _id } if a teammate didn't unpopulate
export async function notifyWishlistItemAvailable(itemRef) {
    const itemId = asItemId(itemRef);
    try {
        // findById(undefined) → findOne({}) would alert everyone on a random item
        if (!itemId) return;
        const item = await Item.findById(itemId, { name: 1, owner: 1, archived: 1, flagged: 1 }, { lean: true });
        if (!item || item.archived || item.flagged) return;
        // the owner can put their own item on their wishlist, they don't need telling it's back
        const wishers = await User.find({ wishlist: item._id, _id: { $ne: item.owner } }, { _id: 1 }, { lean: true });
        // it stays on their wishlist, so they hear every time it comes back. no cooldown on purpose
        const details = {
            // favourite-available is already on Yara's shared enum for wishlist; renaming it would break the model
            type: 'favourite-available',
            subject: 'An item on your wishlist is available',
            message: `"${item.name}" on your wishlist is available to reserve again`
        };
        await Promise.all(wishers.map(({ _id }) => notifyOrLog(_id, 'wishlist alert', details, itemId)));
    } catch (error) {
        console.error(`failed to send the wishlist alerts for ${itemId}`, error);
    }
}

export async function notifyWaitlistItemAvailable(itemRef) {
    const itemId = asItemId(itemRef);
    try {
        if (!itemId) return;
        const item = await Item.findById(itemId, { name: 1, owner: 1, archived: 1, flagged: 1 }, { lean: true });
        if (!item || item.archived || item.flagged) return;

        const now = new Date();
        const waitlists = await Waitlist.find(
            { item: item._id, startDate: { $lt: now }, endDate: { $gt: now } },
            { username: 1 },
            { lean: true }
        );
        const usernames = new Set(
            waitlists.map(({ username }) => username).filter((username) => username !== item.owner)
        );
        const details = {
            type: 'waitlist-available',
            subject: 'An item on your waitlist is available',
            message: `"${item.name}" on your waitlist is available to reserve now`
        };
        await Promise.all([...usernames].map((username) =>
            notifyOrLog(username, 'waitlist alert', details, itemId)
        ));
    } catch (error) {
        console.error(`failed to send the waitlist alerts for ${itemId}`, error);
    }
}
