import { beforeEach, describe, expect, it, vi } from 'vitest';
import nodemailer from 'nodemailer';
import { sendNotificationEmail } from '../services/emailService.js';

vi.mock('nodemailer', () => ({ default: { createTransport: vi.fn() } }));
vi.mock('../config/env.js', () => ({
    env: { smtpPass: 'reset-password', notifySmtpUser: 'shirshad.app@gmail.com', notifySmtpPass: 'notify-password' }
}));

const sendMail = vi.fn();
beforeEach(() => {
    sendMail.mockReset();
    sendMail.mockResolvedValue({});
    nodemailer.createTransport.mockReturnValue({ sendMail });
});

describe('sendNotificationEmail', () => {
    // the notify gmail, never the reset sender, and timeouts so a stuck gmail gives up instead of hanging
    // this runs first, the transporter is made once per test file so later tests reuse it
    it('sends from the notify gmail through one reused pool with short timeouts', async () => {
        await sendNotificationEmail('yara@example.com', 'Reservation confirmed', 'Confirmed');
        await sendNotificationEmail('martin@example.com', 'Reservation confirmed', 'Confirmed');

        expect(nodemailer.createTransport).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            host: 'smtp.gmail.com',
            pool: true,
            connectionTimeout: 10000,
            greetingTimeout: 10000,
            socketTimeout: 30000,
            auth: { user: 'shirshad.app@gmail.com', pass: 'notify-password' }
        }));
        expect(sendMail).toHaveBeenCalledTimes(2);
        expect(sendMail).toHaveBeenNthCalledWith(1, {
            from: { name: 'ShareShed', address: 'shirshad.app@gmail.com' },
            to: 'yara@example.com',
            subject: 'Reservation confirmed',
            text: 'Confirmed'
        });
    });

    it('passes delivery errors up so notify can log them', async () => {
        sendMail.mockRejectedValue(new Error('SMTP unavailable'));

        await expect(sendNotificationEmail('a@example.com', 's', 't')).rejects.toThrow('SMTP unavailable');
    });
});
