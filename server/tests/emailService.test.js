import { beforeEach, describe, expect, it, vi } from 'vitest';
import nodemailer from 'nodemailer';
import { sendResetEmail } from '../services/emailService.js';

vi.mock('nodemailer', () => ({ default: { createTransport: vi.fn() } }));
vi.mock('../config/env.js', () => ({
    env: { notifySmtpUser: 'shareshed@gmail.com', notifySmtpPass: 'notify-password' }
}));
const sendMail = vi.fn();
beforeEach(() => {
    vi.resetAllMocks();
    nodemailer.createTransport.mockReturnValue({ sendMail });
    sendMail.mockResolvedValue({});
});

describe('sendResetEmail', () => {
    it('uses the notify gmail and sends the OTP under the ACL Support name', async () => {
        await sendResetEmail('recipient@example.com', '004281');
        const configuration = nodemailer.createTransport.mock.calls[0][0];
        expect(configuration).toMatchObject({
            host: 'smtp.gmail.com', port: 587, secure: false,
            auth: { user: 'shareshed@gmail.com', pass: 'notify-password' }
        });
        expect(sendMail).toHaveBeenCalledExactlyOnceWith({
            from: { name: 'ACL Support', address: 'shareshed@gmail.com' },
            to: 'recipient@example.com',
            subject: 'Your password reset code',
            text: 'Your reset code is 004281. It expires in 10 minutes. If you did not request this, ignore this email.'
        });
    });

    it('propagates delivery errors to the controller', async () => {
        sendMail.mockRejectedValue(new Error('SMTP unavailable'));
        await expect(sendResetEmail('recipient@example.com', '004281'))
            .rejects.toThrow('SMTP unavailable');
    });
});
