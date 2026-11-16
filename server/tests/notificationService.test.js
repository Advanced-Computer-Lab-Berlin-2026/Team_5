import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    notify, notifyWishlistItemAvailable, notifyReservationCancelled, notifyReservationConfirmed, notifyReservationRejected
} from '../services/notificationService.js';
import { sendNotificationEmail } from '../services/emailService.js';
import { env } from '../config/env.js';
import { Notification } from '../models/Notification.js';
import { User } from '../models/User.js';
import { Item } from '../models/Item.js';

// env is the mock's own object, so each test can switch the gmail on and off
vi.mock('../config/env.js', () => ({ env: {} }));
vi.mock('../services/emailService.js', () => ({ sendNotificationEmail: vi.fn() }));
vi.mock('../models/Notification.js', () => ({ Notification: { create: vi.fn() } }));
vi.mock('../models/User.js', () => ({ User: { findById: vi.fn(), find: vi.fn() } }));
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

    // findById(undefined) would pick a random item, so a missing id must fall back without looking up
    it('still tells both without the item name when the item id is missing', async () => {
        await notifyReservationConfirmed({ ...reservation, item: undefined });

        expect(Item.findById).not.toHaveBeenCalled();
        expect(Notification.create).toHaveBeenCalledWith(
            confirmed('yara', 'Your reservation for the item from 20 Nov 2026 to 23 Nov 2026 is confirmed')
        );
    });

    it('still tells both without the item name when the item is gone', async () => {
        Item.findById.mockResolvedValue(null);

        await notifyReservationConfirmed(reservation);

        expect(console.warn).toHaveBeenCalledWith('item ITEM-1 not found for RES-1a2b3c4d, sending the confirmation without its name');
        expect(Notification.create).toHaveBeenCalledWith(
            confirmed('yara', 'Your reservation for the item from 20 Nov 2026 to 23 Nov 2026 is confirmed')
        );
        expect(Notification.create).toHaveBeenCalledWith(
            confirmed('martin', 'yara\'s reservation for your item from 20 Nov 2026 to 23 Nov 2026 is confirmed')
        );
        await vi.waitFor(() => expect(sendNotificationEmail).toHaveBeenCalledTimes(2));
    });

    // if the item lookup fails the saves would fail too, so nobody is notified and it's logged once, not thrown
    it('logs and notifies nobody when the item lookup fails', async () => {
        Item.findById.mockRejectedValue(new Error('db down'));

        await expect(notifyReservationConfirmed(reservation)).resolves.toBeUndefined();

        expect(console.error).toHaveBeenCalledWith('failed to send the confirmation for RES-1a2b3c4d', expect.any(Error));
        expect(Notification.create).not.toHaveBeenCalled();
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

describe('cancel and reject notifications', () => {
    // the end is 23:30 utc, which is already the 23rd in berlin
    const reservation = {
        _id: 'RES-1a2b3c4d', item: 'ITEM-1', borrower: 'yara', lender: 'martin',
        startDate: new Date('2026-11-20T10:00:00Z'), endDate: new Date('2026-11-22T23:30:00Z')
    };
    const expectedNotification = (username, type, message) => ({ username, type, message, reservation: 'RES-1a2b3c4d' });

    // create echoes what it saved and each user has their own email, so each email can be checked against its message
    beforeEach(() => {
        Item.findById.mockResolvedValue({ name: 'Drill' });
        Notification.create.mockImplementation(async (doc) => ({ _id: 'NOT-1a2b3c4d', ...doc }));
        User.findById.mockImplementation(async (username) => ({ profile: { email: `${username}@example.com` } }));
    });

    describe('notifyReservationCancelled', () => {
        it('tells the member and the lender, in-app and by email', async () => {
            const borrowerMessage = 'You cancelled your reservation for "Drill" from 20 Nov 2026 to 23 Nov 2026';
            const lenderMessage = 'yara cancelled their reservation for your "Drill" from 20 Nov 2026 to 23 Nov 2026';

            await notifyReservationCancelled(reservation);

            // other, because the shared notification model has no cancelled type
            expect(Notification.create).toHaveBeenCalledWith(expectedNotification('yara', 'other', borrowerMessage));
            expect(Notification.create).toHaveBeenCalledWith(expectedNotification('martin', 'other', lenderMessage));
            await vi.waitFor(() => expect(sendNotificationEmail).toHaveBeenCalledTimes(2));
            expect(sendNotificationEmail).toHaveBeenCalledWith('yara@example.com', 'Reservation cancelled', borrowerMessage);
            expect(sendNotificationEmail).toHaveBeenCalledWith('martin@example.com', 'Reservation cancelled', lenderMessage);
        });

        it('still tells both, by email too, without the item name when the item is gone', async () => {
            Item.findById.mockResolvedValue(null);

            await notifyReservationCancelled(reservation);

            expect(console.warn).toHaveBeenCalledWith('item ITEM-1 not found for RES-1a2b3c4d, sending the cancellation without its name');
            expect(Notification.create).toHaveBeenCalledWith(
                expectedNotification('yara', 'other', 'You cancelled your reservation for the item from 20 Nov 2026 to 23 Nov 2026')
            );
            expect(Notification.create).toHaveBeenCalledWith(
                expectedNotification('martin', 'other', 'yara cancelled their reservation for your item from 20 Nov 2026 to 23 Nov 2026')
            );
            await vi.waitFor(() => expect(sendNotificationEmail).toHaveBeenCalledTimes(2));
        });

        // the borrower's save goes first, so mockRejectedValueOnce fails theirs and the lender's still has to go out
        it('logs a failed save and still notifies the other side', async () => {
            Notification.create.mockRejectedValueOnce(new Error('db down'));

            await expect(notifyReservationCancelled(reservation)).resolves.toBeUndefined();

            expect(console.error).toHaveBeenCalledWith('failed to save the cancellation for RES-1a2b3c4d to yara', expect.any(Error));
            expect(Notification.create).toHaveBeenLastCalledWith(
                expectedNotification('martin', 'other', 'yara cancelled their reservation for your "Drill" from 20 Nov 2026 to 23 Nov 2026')
            );
        });

        it('logs instead of throwing when it gets no reservation', async () => {
            await expect(notifyReservationCancelled(undefined)).resolves.toBeUndefined();

            expect(console.error).toHaveBeenCalledWith('failed to send the cancellation for undefined', expect.any(TypeError));
        });
    });

    describe('notifyReservationRejected', () => {
        it('tells the member and the lender, in-app and by email', async () => {
            const borrowerMessage = 'martin rejected your reservation request for "Drill" from 20 Nov 2026 to 23 Nov 2026';
            const lenderMessage = 'You rejected yara\'s reservation request for your "Drill" from 20 Nov 2026 to 23 Nov 2026';

            await notifyReservationRejected(reservation);

            expect(Notification.create).toHaveBeenCalledWith(expectedNotification('yara', 'rejected', borrowerMessage));
            expect(Notification.create).toHaveBeenCalledWith(expectedNotification('martin', 'rejected', lenderMessage));
            await vi.waitFor(() => expect(sendNotificationEmail).toHaveBeenCalledTimes(2));
            expect(sendNotificationEmail).toHaveBeenCalledWith('yara@example.com', 'Reservation request rejected', borrowerMessage);
            expect(sendNotificationEmail).toHaveBeenCalledWith('martin@example.com', 'Reservation request rejected', lenderMessage);
        });

        it('still tells both without the item name when the item is gone', async () => {
            Item.findById.mockResolvedValue(null);

            await notifyReservationRejected(reservation);

            expect(console.warn).toHaveBeenCalledWith('item ITEM-1 not found for RES-1a2b3c4d, sending the rejection without its name');
            expect(Notification.create).toHaveBeenCalledWith(
                expectedNotification('yara', 'rejected', 'martin rejected your reservation request for their item from 20 Nov 2026 to 23 Nov 2026')
            );
            expect(Notification.create).toHaveBeenCalledWith(
                expectedNotification('martin', 'rejected', 'You rejected yara\'s reservation request for your item from 20 Nov 2026 to 23 Nov 2026')
            );
        });

        it('logs instead of throwing when it gets no reservation', async () => {
            await expect(notifyReservationRejected(undefined)).resolves.toBeUndefined();

            expect(console.error).toHaveBeenCalledWith('failed to send the rejection for undefined', expect.any(TypeError));
        });
    });

    // create is mocked everywhere else, so a type that isn't in the real enum would only show up as a logged failed save
    it.each([
        ['notifyReservationConfirmed', notifyReservationConfirmed],
        ['notifyReservationCancelled', notifyReservationCancelled],
        ['notifyReservationRejected', notifyReservationRejected]
    ])(
        '%s saves notifications the real schema accepts',
        async (name, notifyReservation) => {
            const { Notification: RealNotification } = await vi.importActual('../models/Notification.js');

            await notifyReservation(reservation);

            expect(Notification.create).toHaveBeenCalledTimes(2);
            for (const [doc] of Notification.create.mock.calls) {
                expect(new RealNotification(doc).validateSync()).toBeUndefined();
            }
        }
    );
});

describe('notifyWishlistItemAvailable', () => {
    const drill = { _id: 'ITM-1a2b3c4d', name: 'Drill', owner: 'martin', archived: false, flagged: false };
    const message = '"Drill" on your wishlist is available to reserve again';
    const alert = (username) => ({ username, type: 'favourite-available', message, reservation: undefined });

    // create echoes what it saved and each user has their own email, so each email can be checked against its message
    beforeEach(() => {
        Item.findById.mockResolvedValue(drill);
        User.find.mockResolvedValue([{ _id: 'yara' }, { _id: 'daniel' }]);
        Notification.create.mockImplementation(async (doc) => ({ _id: 'NOT-1a2b3c4d', ...doc }));
        User.findById.mockImplementation(async (username) => ({ profile: { email: `${username}@example.com` } }));
    });

    it('tells everyone who has it on their wishlist, in-app and by email', async () => {
        await notifyWishlistItemAvailable('ITM-1a2b3c4d');

        // without archived and flagged in the projection they'd come back undefined and the skip would never fire
        expect(Item.findById).toHaveBeenCalledWith('ITM-1a2b3c4d', { name: 1, owner: 1, archived: 1, flagged: 1 }, { lean: true });
        expect(Notification.create).toHaveBeenCalledWith(alert('yara'));
        expect(Notification.create).toHaveBeenCalledWith(alert('daniel'));
        await vi.waitFor(() => expect(sendNotificationEmail).toHaveBeenCalledTimes(2));
        expect(sendNotificationEmail).toHaveBeenCalledWith('yara@example.com', 'An item on your wishlist is available', message);
        expect(sendNotificationEmail).toHaveBeenCalledWith('daniel@example.com', 'An item on your wishlist is available', message);
    });

    // arg and loaded _id differ on purpose, so a revert to wishlist: itemId would fail this
    it('queries wishlisters by the loaded item id and leaves the owner out', async () => {
        Item.findById.mockResolvedValue({ ...drill, _id: 'ITM-CANONICAL' });

        await notifyWishlistItemAvailable('ITM-ARG');

        expect(User.find).toHaveBeenCalledWith({ wishlist: 'ITM-CANONICAL', _id: { $ne: 'martin' } }, { _id: 1 }, { lean: true });
    });

    it('does nothing when nobody has it on their wishlist', async () => {
        User.find.mockResolvedValue([]);

        await notifyWishlistItemAvailable('ITM-1a2b3c4d');

        expect(Notification.create).not.toHaveBeenCalled();
    });

    // an item that's still archived or flagged, or got deleted, isn't available, whoever called this
    it.each([
        ['archived', { ...drill, archived: true }],
        ['flagged', { ...drill, flagged: true }],
        ['deleted', null]
    ])('skips an item that is %s', async (state, item) => {
        Item.findById.mockResolvedValue(item);

        await notifyWishlistItemAvailable('ITM-1a2b3c4d');

        expect(User.find).not.toHaveBeenCalled();
        expect(Notification.create).not.toHaveBeenCalled();
        // a crash would also skip everything, so this checks it skipped on purpose
        expect(console.error).not.toHaveBeenCalled();
    });

    // findById(undefined) is findOne({}) in mongoose, so a missing or object id would pick a random item
    it.each([
        ['undefined', undefined],
        ['an object', { $ne: 'x' }]
    ])('does nothing when the id is %s', async (label, itemId) => {
        await notifyWishlistItemAvailable(itemId);

        expect(Item.findById).not.toHaveBeenCalled();
        expect(User.find).not.toHaveBeenCalled();
        expect(Notification.create).not.toHaveBeenCalled();
    });

    // yara's save goes first, so mockRejectedValueOnce fails hers and daniel's still has to go out
    it('logs a failed save and still tells the others', async () => {
        Notification.create.mockRejectedValueOnce(new Error('db down'));

        await expect(notifyWishlistItemAvailable('ITM-1a2b3c4d')).resolves.toBeUndefined();

        expect(console.error).toHaveBeenCalledWith('failed to save the wishlist alert for ITM-1a2b3c4d to yara', expect.any(Error));
        expect(Notification.create).toHaveBeenLastCalledWith(alert('daniel'));
    });

    it.each([
        ['item', () => Item.findById.mockRejectedValue(new Error('db down'))],
        ['wishlist', () => User.find.mockRejectedValue(new Error('db down'))]
    ])('logs instead of throwing when the %s lookup fails', async (label, breakLookup) => {
        breakLookup();

        await expect(notifyWishlistItemAvailable('ITM-1a2b3c4d')).resolves.toBeUndefined();

        expect(console.error).toHaveBeenCalledWith('failed to send the wishlist alerts for ITM-1a2b3c4d', expect.any(Error));
    });

    // create is mocked above, so this checks the type is really in the shared enum
    it('saves notifications the real schema accepts', async () => {
        const { Notification: RealNotification } = await vi.importActual('../models/Notification.js');

        await notifyWishlistItemAvailable('ITM-1a2b3c4d');

        for (const [doc] of Notification.create.mock.calls) {
            expect(new RealNotification(doc).validateSync()).toBeUndefined();
        }
        expect(Notification.create).toHaveBeenCalledTimes(2);
    });
});
