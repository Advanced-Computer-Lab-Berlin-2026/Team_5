import { beforeEach, describe, expect, it, vi } from 'vitest';
import { notify, notifyReservationConfirmed } from '../services/notificationService.js';
import { sendNotificationEmail } from '../services/emailService.js';
import { env } from '../config/env.js';
import { Notification } from '../models/Notification.js';
import { User } from '../models/User.js';
import { Item } from '../models/Item.js';

// env is the mock's own object, so each test can switch the gmail on and off
vi.mock('../config/env.js', () => ({ env: {} }));
vi.mock('../services/emailService.js', () => ({ sendNotificationEmail: vi.fn() }));
vi.mock('../models/Notification.js', () => ({ Notification: { create: vi.fn() } }));
vi.mock('../models/User.js', () => ({ User: { findById: vi.fn() } }));
vi.mock('../models/Item.js', () => ({ Item: { findById: vi.fn() } }));

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

describe('notifyReservationConfirmed', () => {
    // the end is 23:30 utc, which is already the 23rd in berlin
    const reservation = {
        _id: 'RES-1a2b3c4d', item: 'ITEM-1', borrower: 'yara', lender: 'martin',
        startDate: new Date('2026-11-20T10:00:00Z'), endDate: new Date('2026-11-22T23:30:00Z')
    };
    const confirmed = (username, message) => ({ username, type: 'accepted', message, reservation: 'RES-1a2b3c4d' });

    // create echoes what it saved and each user has their own email, so each email can be checked against its message
    beforeEach(() => {
        Item.findById.mockResolvedValue({ name: 'Drill' });
        Notification.create.mockImplementation(async (doc) => ({ _id: 'NOT-1a2b3c4d', ...doc }));
        User.findById.mockImplementation(async (username) => ({ profile: { email: `${username}@example.com` } }));
    });

    it('tells the member and the lender, in-app and by email, with the item and berlin dates', async () => {
        const memberMessage = 'Your reservation for "Drill" from 20 Nov 2026 to 23 Nov 2026 is confirmed';
        const lenderMessage = 'yara\'s reservation for your "Drill" from 20 Nov 2026 to 23 Nov 2026 is confirmed';

        await notifyReservationConfirmed(reservation);

        expect(Notification.create).toHaveBeenCalledWith(confirmed('yara', memberMessage));
        expect(Notification.create).toHaveBeenCalledWith(confirmed('martin', lenderMessage));
        await vi.waitFor(() => expect(sendNotificationEmail).toHaveBeenCalledTimes(2));
        expect(sendNotificationEmail).toHaveBeenCalledWith('yara@example.com', 'Reservation confirmed', memberMessage);
        expect(sendNotificationEmail).toHaveBeenCalledWith('martin@example.com', 'Reservation confirmed', lenderMessage);
    });

    // a hand built reservation might have string dates instead of Date objects
    it('works with string dates', async () => {
        await notifyReservationConfirmed({ ...reservation, startDate: '2026-11-20T10:00:00Z', endDate: '2026-11-22T23:30:00Z' });

        expect(Notification.create).toHaveBeenCalledWith(
            confirmed('yara', 'Your reservation for "Drill" from 20 Nov 2026 to 23 Nov 2026 is confirmed')
        );
    });

    it('still tells both without the item name when the item is gone', async () => {
        Item.findById.mockResolvedValue(null);

        await notifyReservationConfirmed(reservation);

        expect(console.warn).toHaveBeenCalledWith('item ITEM-1 not found for RES-1a2b3c4d, sending the confirmation without its name');
        expect(Notification.create).toHaveBeenCalledWith(
            confirmed('yara', 'Your reservation for their item from 20 Nov 2026 to 23 Nov 2026 is confirmed')
        );
        expect(Notification.create).toHaveBeenCalledWith(
            confirmed('martin', 'yara\'s reservation for your item from 20 Nov 2026 to 23 Nov 2026 is confirmed')
        );
        await vi.waitFor(() => expect(sendNotificationEmail).toHaveBeenCalledTimes(2));
    });

    // a database hiccup on the item lookup shouldn't stop a real booking from being announced
    it('treats a failed item lookup like a missing item', async () => {
        Item.findById.mockRejectedValue(new Error('db down'));

        await expect(notifyReservationConfirmed(reservation)).resolves.toBeUndefined();

        expect(console.error).toHaveBeenCalledWith('failed to look up item ITEM-1 for RES-1a2b3c4d', expect.any(Error));
        expect(Notification.create).toHaveBeenCalledWith(
            confirmed('yara', 'Your reservation for their item from 20 Nov 2026 to 23 Nov 2026 is confirmed')
        );
        expect(Notification.create).toHaveBeenCalledTimes(2);
    });

    // the lender still gets theirs when the member's save fails, and nothing reaches the caller
    it('logs a failed save and still notifies the other side', async () => {
        Notification.create.mockRejectedValueOnce(new Error('db down'));

        await expect(notifyReservationConfirmed(reservation)).resolves.toBeUndefined();

        expect(console.error).toHaveBeenCalledWith('failed to save the confirmation for RES-1a2b3c4d to yara', expect.any(Error));
        expect(Notification.create).toHaveBeenLastCalledWith(
            confirmed('martin', 'yara\'s reservation for your "Drill" from 20 Nov 2026 to 23 Nov 2026 is confirmed')
        );
    });

    it('logs instead of throwing when it gets no reservation', async () => {
        await expect(notifyReservationConfirmed(undefined)).resolves.toBeUndefined();

        expect(console.error).toHaveBeenCalledWith('failed to send the confirmation for undefined', expect.any(TypeError));
    });
});
