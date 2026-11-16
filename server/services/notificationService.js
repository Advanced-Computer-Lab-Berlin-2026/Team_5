import { Notification, User } from '../models/index.js';
import { sendNotificationEmail } from './emailService.js';
import { env } from '../config/env.js';

// nothing calls this yet, the reservation flows switch over to it in SCRUM-354 / SCRUM-355
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
