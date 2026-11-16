import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

// Replace these with your email provider's SMTP host and your sender address.
const SMTP_HOST = 'smtp.gmail.com';
const SMTP_PORT = 587;
const SENDER_EMAIL = 'martin@awadlouis.com';

export async function sendResetEmail(email, otp) {
    const transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465,
        auth: {
            user: SENDER_EMAIL,
            pass: env.smtpPass
        }
    });

    await transporter.sendMail({
        from: { name: 'ACL Support', address: SENDER_EMAIL },
        to: email,
        subject: 'Your password reset code',
        text: `Your reset code is ${otp}. It expires in 10 minutes. If you did not request this, ignore this email.`
    });
}

let notifyTransporter;

// notify emails go out from the app's own gmail, not the reset sender above
// I make one pool (up to 2 connections) and reuse it, a new gmail login per email gets rate limited
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

export async function sendNotificationEmail(to, subject, text) {
    await getNotifyTransporter().sendMail({
        from: { name: 'ShareShed', address: env.notifySmtpUser },
        to,
        subject,
        text
    });
}
