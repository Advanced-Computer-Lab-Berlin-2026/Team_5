import { beforeEach, describe, expect, it, vi } from 'vitest';
import { notify } from '../services/notificationService.js';
import { sendNotificationEmail } from '../services/emailService.js';
import { env } from '../config/env.js';
import { Notification } from '../models/Notification.js';
import { User } from '../models/User.js';

// env is the mock's own object, so each test can switch the gmail on and off
vi.mock('../config/env.js', () => ({ env: {} }));
vi.mock('../services/emailService.js', () => ({ sendNotificationEmail: vi.fn() }));
vi.mock('../models/Notification.js', () => ({ Notification: { create: vi.fn() } }));
vi.mock('../models/User.js', () => ({ User: { findById: vi.fn() } }));

const saved = { _id: 'NOT-1a2b3c4d', username: 'yara', type: 'accepted', message: 'Your reservation for "Drill" & case is confirmed' };

beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    Object.assign(env, { notifySmtpUser: 'shirshad.app@gmail.com', notifySmtpPass: 'app-password' });
    Notification.create.mockResolvedValue(saved);
    User.findById.mockResolvedValue({ profile: { email: 'yara@example.com' } });
    sendNotificationEmail.mockResolvedValue({});
});

describe('notify', () => {
    it('saves the in-app notification and returns it', async () => {
        const notification = await notify('yara', { type: 'accepted', message: saved.message, reservation: 'RES-1' });

        expect(Notification.create).toHaveBeenCalledWith({ username: 'yara', type: 'accepted', message: saved.message, reservation: 'RES-1' });
        expect(notification).toBe(saved);
    });

    it('emails the user the same message', async () => {
        await notify('yara', { type: 'accepted', message: saved.message, subject: 'Reservation confirmed' });

        await vi.waitFor(() => expect(sendNotificationEmail).toHaveBeenCalledExactlyOnceWith(
            'yara@example.com', 'Reservation confirmed', saved.message
        ));
        expect(User.findById).toHaveBeenCalledWith('yara', { 'profile.email': 1 }, { lean: true });
    });

    // sendNotificationEmail never resolves here, notify still has to return
    it('returns before the email is sent', async () => {
        sendNotificationEmail.mockReturnValue(new Promise(() => {}));

        await expect(notify('yara', { message: saved.message })).resolves.toBe(saved);
    });

    it('logs a failed email instead of throwing', async () => {
        sendNotificationEmail.mockRejectedValue(new Error('SMTP unavailable'));

        await expect(notify('yara', { message: saved.message })).resolves.toBe(saved);
        await vi.waitFor(() => expect(console.error).toHaveBeenCalledWith(
            expect.stringContaining('failed to send email for NOT-1a2b3c4d to yara'), expect.any(Error)
        ));
    });

    it('skips the email and logs it when the user has no email on file', async () => {
        User.findById.mockResolvedValue({ profile: {} });

        await notify('yara', { message: saved.message });

        await vi.waitFor(() => expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('yara has no email on file')));
        expect(sendNotificationEmail).not.toHaveBeenCalled();
    });

    it('skips the email when the notify gmail isn\'t set up', async () => {
        env.notifySmtpPass = undefined;

        await notify('yara', { message: saved.message });

        await vi.waitFor(() => expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('NOTIFY_SMTP_USER / NOTIFY_SMTP_PASS')));
        expect(User.findById).not.toHaveBeenCalled();
        expect(sendNotificationEmail).not.toHaveBeenCalled();
    });

    // the save happens first, so a failed save means no email about something that isn't there
    it('doesn\'t email when the in-app save fails', async () => {
        Notification.create.mockRejectedValue(new Error('db down'));

        await expect(notify('yara', { message: saved.message })).rejects.toThrow('db down');
        expect(sendNotificationEmail).not.toHaveBeenCalled();
    });
});
