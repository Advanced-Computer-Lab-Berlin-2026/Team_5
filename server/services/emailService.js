import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

const SMTP_HOST = 'smtp.gmail.com';
const SMTP_PORT = 587;

let notifyTransporter;

// one pool for reset + notification mail — both use NOTIFY_SMTP_* (no hardcoded sender / SMTP_PASS)
function getNotifyTransporter() {
    notifyTransporter ??= nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465,
        pool: true,
        // kept low so a burst doesn't open lots of logins at once and get the gmail account blocked
        maxConnections: 2,
        // the defaults wait up to 2 minutes just to connect, these make a stuck gmail give up instead of hanging for minutes
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 30000,
        auth: {
            user: env.notifySmtpUser,
            pass: env.notifySmtpPass
        }
    });
    return notifyTransporter;
}

function requireNotifySmtp() {
    if (!env.notifySmtpUser || !env.notifySmtpPass) {
        throw new Error("NOTIFY_SMTP_USER / NOTIFY_SMTP_PASS aren't set");
    }
}

export async function sendResetEmail(email, otp) {
    requireNotifySmtp();
    await getNotifyTransporter().sendMail({
        from: { name: 'ACL Support', address: env.notifySmtpUser },
        to: email,
        subject: 'Your password reset code',
        text: `Your reset code is ${otp}. It expires in 10 minutes. If you did not request this, ignore this email.`
    });
}

export async function sendNotificationEmail(to, subject, text) {
    await getNotifyTransporter().sendMail({
        from: { name: 'ShareShed', address: env.notifySmtpUser },
        to,
        subject,
        text
    });
}
