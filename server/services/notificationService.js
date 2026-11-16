import { Item, Notification, User } from '../models/index.js';
import { sendNotificationEmail } from './emailService.js';
import { env } from '../config/env.js';

// nothing reaches this from a route yet. approve gets it through notifyReservationConfirmed (SCRUM-352), cancel / reject in SCRUM-355
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

// nothing calls this yet, it goes right after the approve transaction commits in SCRUM-352 (pending -> upcoming)
// I log errors instead of throwing, so a failed notification can't turn a booking that already went through into a 500
// pass the reservation without populate on borrower, a populated user prints whole (password hash, email) into the lender's message
// call it once, only when the status: 'pending' update actually changed the reservation, or a double confirm sends everything twice
export async function notifyReservationConfirmed(reservation) {
    try {
        const { _id, item: itemId, borrower, lender, startDate, endDate } = reservation;
        // a failed lookup counts as a deleted item, the booking is still real so both sides hear about it anyway
        const item = await Item.findById(itemId, { name: 1 }, { lean: true }).catch((error) => {
            console.error(`failed to look up item ${itemId} for ${_id}`, error);
            return null;
        });
        if (!item) console.warn(`item ${itemId} not found for ${_id}, sending the confirmation without its name`);
        const name = item && `"${item.name}"`;
        // new Date so a plain object with string dates works too
        const format = (date) => new Date(date).toLocaleDateString('en-GB', DATE_FORMAT);
        const dates = `from ${format(startDate)} to ${format(endDate)}`;

        const send = (username, message) =>
            notify(username, { type: 'accepted', subject: 'Reservation confirmed', message, reservation: _id })
                .catch((error) => console.error(`failed to save the confirmation for ${_id} to ${username}`, error));
        await Promise.all([
            send(borrower, `Your reservation for ${name ?? 'their item'} ${dates} is confirmed`),
            send(lender, `${borrower}'s reservation for your ${name ?? 'item'} ${dates} is confirmed`)
        ]);
    } catch (error) {
        console.error(`failed to send the confirmation for ${reservation?._id}`, error);
    }
}
