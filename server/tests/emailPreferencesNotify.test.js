import { beforeEach, describe, expect, it, vi } from 'vitest';
import { notify } from '../services/notificationService.js';
import { sendNotificationEmail } from '../services/emailService.js';
import { env } from '../config/env.js';
import { Notification } from '../models/Notification.js';
import { User } from '../models/User.js';

vi.mock('../config/env.js', () => ({ env: {} }));
vi.mock('../services/emailService.js', () => ({ sendNotificationEmail: vi.fn() }));
vi.mock('../models/Notification.js', () => ({ Notification: { create: vi.fn() } }));
vi.mock('../models/User.js', () => ({ User: { findById: vi.fn() } }));

const saved = { _id: 'NOT-1a2b3c4d', username: 'yara', type: 'accepted', message: 'Your reservation for "Drill" & case is confirmed' };

beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    Object.assign(env, { notifySmtpUser: 'shirshad.app@gmail.com', notifySmtpPass: 'app-password' });
    Notification.create.mockResolvedValue(saved);
    User.findById.mockResolvedValue({ profile: { email: 'yara@example.com' } });
    sendNotificationEmail.mockResolvedValue({});
});

// SCRUM-519: in-app row still saved; only the gmail respects the category switch
describe('notify email preferences (SCRUM-519)', () => {
    it.each([
        ['accepted', { type: 'accepted', message: saved.message, subject: 'Reservation confirmed' }],
        [
            'favourite-available',
            {
                type: 'favourite-available',
                message: '"Drill" on your wishlist is available to reserve again',
                subject: 'Wishlist item available'
            }
        ]
    ])('skips email when reservations are off (%s)', async (type, payload) => {
        Notification.create.mockResolvedValue({ ...saved, type, username: 'yara' });
        User.findById.mockResolvedValue({
            profile: { email: 'yara@example.com' },
            emailPreferences: { reservations: false, promotions: true, communityNotices: true }
        });

        await notify('yara', payload);

        await vi.waitFor(() => expect(console.warn).toHaveBeenCalledWith(
            expect.stringContaining('turned off reservations')
        ));
        expect(sendNotificationEmail).not.toHaveBeenCalled();
        expect(Notification.create).toHaveBeenCalled();
        if (type === 'accepted') {
            expect(User.findById).toHaveBeenCalledWith(
                'yara',
                { 'profile.email': 1, emailPreferences: 1 },
                { lean: true }
            );
        }
    });

    it('skips email when community notices are off', async () => {
        Notification.create.mockResolvedValue({
            ...saved,
            type: 'community-notice',
            username: 'yara',
            message: 'Hall closed Sunday'
        });
        User.findById.mockResolvedValue({
            profile: { email: 'yara@example.com' },
            emailPreferences: { reservations: true, promotions: true, communityNotices: false }
        });

        await notify('yara', {
            type: 'community-notice',
            message: 'Hall closed Sunday',
            subject: 'Community notice'
        });

        await vi.waitFor(() => expect(console.warn).toHaveBeenCalledWith(
            expect.stringContaining('turned off communityNotices')
        ));
        expect(sendNotificationEmail).not.toHaveBeenCalled();
        expect(Notification.create).toHaveBeenCalled();
    });

    it('still emails community notices when only reservations are off', async () => {
        Notification.create.mockResolvedValue({
            ...saved,
            type: 'community-notice',
            username: 'yara',
            message: 'Hall closed Sunday'
        });
        User.findById.mockResolvedValue({
            profile: { email: 'yara@example.com' },
            emailPreferences: { reservations: false, promotions: true, communityNotices: true }
        });

        await notify('yara', {
            type: 'community-notice',
            message: 'Hall closed Sunday',
            subject: 'Community notice'
        });

        await vi.waitFor(() => expect(sendNotificationEmail).toHaveBeenCalledExactlyOnceWith(
            'yara@example.com', 'Community notice', 'Hall closed Sunday'
        ));
    });

    // omitted type becomes "other" in the db, which is still under reservations
    it('skips email when reservations are off and the saved type is other', async () => {
        Notification.create.mockImplementation((doc) => Promise.resolve({
            ...saved,
            ...doc,
            type: doc.type ?? 'other'
        }));
        User.findById.mockResolvedValue({
            profile: { email: 'yara@example.com' },
            emailPreferences: { reservations: false, promotions: true, communityNotices: true }
        });

        await notify('yara', { message: saved.message, subject: 'Reservation update' });

        await vi.waitFor(() => expect(console.warn).toHaveBeenCalledWith(
            expect.stringContaining('turned off reservations')
        ));
        expect(sendNotificationEmail).not.toHaveBeenCalled();
    });

    it('skips email when the type is not mapped to a category yet', async () => {
        Notification.create.mockResolvedValue({
            ...saved,
            type: 'promo-blast',
            username: 'yara'
        });
        User.findById.mockResolvedValue({
            profile: { email: 'yara@example.com' },
            emailPreferences: { reservations: true, promotions: true, communityNotices: true }
        });

        await notify('yara', { type: 'promo-blast', message: saved.message, subject: 'Promo' });

        await vi.waitFor(() => expect(console.warn).toHaveBeenCalledWith(
            expect.stringContaining(`isn't in EMAIL_CATEGORY_BY_TYPE yet`)
        ));
        expect(sendNotificationEmail).not.toHaveBeenCalled();
    });
});