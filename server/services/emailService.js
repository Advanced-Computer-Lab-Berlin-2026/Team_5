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
