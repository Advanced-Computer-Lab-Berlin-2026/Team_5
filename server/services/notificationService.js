import { Item, Notification, User } from '../models/index.js';
import { sendNotificationEmail } from './emailService.js';
import { env } from '../config/env.js';

// no route reaches this yet, only the notifyReservation* helpers below call it
// those get called from the approve / reject in SCRUM-352 and the cancel in SCRUM-351
// callers run this after their transaction commits, so nobody gets emailed about a change that got rolled back
// not inside withTransaction, that callback can retry and send the same email twice
// callers should catch and log errors from it, or a failed save turns an already committed booking into a 500
export async function notify(username, { type, message, subject, reservation }) {
    const notification = await Notification.create({ username, type, message, reservation });

    // I don't await the email so a slow gmail never slows the request, it still goes out right after
    // no retry or queue on purpose, if it fails the in-app one is already saved
    emailUser(notification, subject).catch((error) =>
        console.error(`failed to send email for ${notification._id} to ${username}, the in-app one is saved`, error)
    );
    return notification;
}

async function emailUser(notification, subject) {
    if (!env.notifySmtpUser || !env.notifySmtpPass) {
        console.warn(`email skipped for ${notification._id}, NOTIFY_SMTP_USER / NOTIFY_SMTP_PASS aren't set`);
        return;
    }
    // username is the User _id, so findById works here
    const user = await User.findById(notification.username, { 'profile.email': 1 }, { lean: true });
    const email = user?.profile?.email;
    if (!email) {
        console.warn(`email skipped for ${notification._id}, ${notification.username} has no email on file`);
        return;
    }

    await sendNotificationEmail(email, subject ?? 'You have a new ShareShed notification', notification.message);
}

// berlin time, a utc server would show the wrong day for bookings around midnight
const DATE_FORMAT = { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Berlin' };

// name comes back quoted ("Drill"), or null when the item is gone
// callers fall back to "the item" / "their item" / "item" then
async function itemAndDates({ _id, item: itemId, startDate, endDate }, label) {
    // admin user removal deletes items but keeps reservations, so the item can really be gone
    const item = await Item.findById(itemId, { name: 1 }, { lean: true });
    if (!item) console.warn(`item ${itemId} not found for ${_id}, sending the ${label} without its name`);
    const format = (date) => date.toLocaleDateString('en-GB', DATE_FORMAT);
    return { name: item && `"${item.name}"`, dates: `from ${format(startDate)} to ${format(endDate)}` };
}

// Promise.all rejects on the first failure and only reports that one, so each side catches and logs its own
function notifyOrLog(username, label, details) {
    return notify(username, details)
        .catch((error) => console.error(`failed to save the ${label} for ${details.reservation} to ${username}`, error));
}

// caller rule for all three: pass the doc your status-guarded findOneAndUpdate returned, unpopulated,
// only when it isn't null, and after withTransaction finishes. it logs instead of throwing so it can't 500

// nothing calls this yet, it goes right after the approve commits in SCRUM-352 (pending -> upcoming)
export async function notifyReservationConfirmed(reservation) {
    try {
        const { _id, borrower, lender } = reservation;
        const { name, dates } = await itemAndDates(reservation, 'confirmation');
        const details = { type: 'accepted', subject: 'Reservation confirmed', reservation: _id };
        await Promise.all([
            notifyOrLog(borrower, 'confirmation', { ...details, message: `Your reservation for ${name ?? 'the item'} ${dates} is confirmed` }),
            notifyOrLog(lender, 'confirmation', { ...details, message: `${borrower}'s reservation for your ${name ?? 'item'} ${dates} is confirmed` })
        ]);
    } catch (error) {
        console.error(`failed to send the confirmation for ${reservation?._id}`, error);
    }
}

// nothing calls this yet, it goes after the borrower's cancel commits in SCRUM-351 (pending or upcoming -> cancelled)
// SCRUM-351 only lets the borrower cancel, so the wording assumes it was them
export async function notifyReservationCancelled(reservation) {
    try {
        const { _id, borrower, lender } = reservation;
        const { name, dates } = await itemAndDates(reservation, 'cancellation');
        // the notification model has no cancelled type, so I send it as other instead of touching the shared enum
        const details = { type: 'other', subject: 'Reservation cancelled', reservation: _id };
        await Promise.all([
            notifyOrLog(borrower, 'cancellation', { ...details, message: `You cancelled your reservation for ${name ?? 'the item'} ${dates}` }),
            notifyOrLog(lender, 'cancellation', { ...details, message: `${borrower} cancelled their reservation for your ${name ?? 'item'} ${dates}` })
        ]);
    } catch (error) {
        console.error(`failed to send the cancellation for ${reservation?._id}`, error);
    }
}

// nothing calls this yet, it goes after the lender's reject commits in SCRUM-352 (pending -> rejected)
export async function notifyReservationRejected(reservation) {
    try {
        const { _id, borrower, lender } = reservation;
        const { name, dates } = await itemAndDates(reservation, 'rejection');
        const details = { type: 'rejected', subject: 'Reservation request rejected', reservation: _id };
        await Promise.all([
            notifyOrLog(borrower, 'rejection', { ...details, message: `${lender} rejected your reservation request for ${name ?? 'their item'} ${dates}` }),
            notifyOrLog(lender, 'rejection', { ...details, message: `You rejected ${borrower}'s reservation request for your ${name ?? 'item'} ${dates}` })
        ]);
    } catch (error) {
        console.error(`failed to send the rejection for ${reservation?._id}`, error);
    }
}
