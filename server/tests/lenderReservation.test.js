import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../app.js';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { Reservation } from '../models/Reservation.js';
import { Payment } from '../models/Payment.js';
import { Notification } from '../models/Notification.js';
import { DamageReport } from '../models/DamageReport.js';
import { uploadItemPhoto, deleteItemPhoto } from '../services/itemPhotoStorage.js';
import { rewardReferralIfEligible } from '../services/referralService.js';
import { notify, notifyWishlistItemAvailable } from '../services/notificationService.js';
import { chargeLateFeeForReturn } from '../services/lateFeeService.js';
import { decideExtension, getPendingExtensions, requestExtension } from '../services/extensionService.js';
vi.mock('../models/User.js', () => ({
    User: { findById: vi.fn(), updateOne: vi.fn() }
}));
vi.mock('../services/lateFeeService.js', () => ({
    chargeLateFeeForReturn: vi.fn()
}));
vi.mock('../services/extensionService.js', () => ({
    decideExtension: vi.fn(),
    getPendingExtensions: vi.fn(),
    requestExtension: vi.fn(),
}));
vi.mock('../services/itemPhotoStorage.js', () => ({
    uploadItemPhoto: vi.fn(),
    deleteItemPhoto: vi.fn(),
}));

vi.mock('../services/trustScoreService.js', () => ({
    recalculateTrustScore: vi.fn(),
}));

vi.mock('../services/referralService.js', () => ({
    rewardReferralIfEligible: vi.fn(),
}));

vi.mock('../services/notificationService.js', () => ({
    notify: vi.fn(),
    notifyWishlistItemAvailable: vi.fn(),
}));

const ORIGIN = 'http://localhost:3000';
const token = (id, role) => jwt.sign({ id, role }, env.jwtSecret, { expiresIn: '15m' });
const asLender = () => {
    User.findById.mockResolvedValue({ id: 'lender1', role: 'lender' });
    return `accessToken=${token('lender1', 'lender')}`;
};
const mockReservation = (overrides = {}) => ({
    _id: 'RES-1', item: 'ITM-1', lender: 'lender1', borrower: 'borrower1', status: 'upcoming',
    payment: { depositAmount: 100, method: 'wallet' }, handover: { pickupPhotos: [], returnPhotos: [] },
    save: vi.fn(), ...overrides,
});

beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
});

describe('GET /api/lender/reservations', () => {
    it('lists only the signed-in lender pending reservations with item and borrower details', async () => {
        const cookie = asLender();
        const reservations = [mockReservation()];
        const query = {
            sort: vi.fn(),
            populate: vi.fn(),
            lean: vi.fn().mockResolvedValue(reservations),
        };
        query.sort.mockReturnValue(query);
        query.populate.mockReturnValue(query);
        vi.spyOn(Reservation, 'find').mockReturnValue(query);

        const res = await request(app).get('/api/lender/reservations')
            .set('Origin', ORIGIN).set('Cookie', cookie);

        expect(res.status).toBe(200);
        expect(res.body.reservations).toHaveLength(1);
        expect(Reservation.find).toHaveBeenCalledWith({ lender: 'lender1', status: 'pending' });
        expect(query.populate).toHaveBeenNthCalledWith(1, 'item', 'name photos');
        expect(query.populate).toHaveBeenNthCalledWith(2, 'borrower', 'username profile.name');
    });
});

describe('GET /api/lender/reservations?view=accepted', () => {
    const mockQuery = (result) => {
        const query = { sort: vi.fn(), populate: vi.fn(), lean: vi.fn().mockResolvedValue(result) };
        query.sort.mockReturnValue(query);
        query.populate.mockReturnValue(query);
        vi.spyOn(Reservation, 'find').mockReturnValue(query);
        return query;
    };

    it('lists the lender approved and in-progress bookings, soonest first', async () => {
        const cookie = asLender();
        const query = mockQuery([mockReservation({ status: 'upcoming' })]);

        const res = await request(app).get('/api/lender/reservations?view=accepted')
            .set('Origin', ORIGIN).set('Cookie', cookie);

        expect(res.status).toBe(200);
        expect(res.body.reservations).toHaveLength(1);
        expect(Reservation.find).toHaveBeenCalledWith({ lender: 'lender1', status: { $in: ['upcoming', 'active'] } });
        expect(query.sort).toHaveBeenCalledWith({ startDate: 1 });
    });

    it('rejects an unknown view with 400', async () => {
        const cookie = asLender();
        const find = vi.spyOn(Reservation, 'find');

        const res = await request(app).get('/api/lender/reservations?view=everything')
            .set('Origin', ORIGIN).set('Cookie', cookie);

        expect(res.status).toBe(400);
        expect(find).not.toHaveBeenCalled();
    });
});

describe('PATCH /api/lender/reservations/:id/approve', () => {
    const url = '/api/lender/reservations/RES-1/approve';
    const session = { withTransaction: vi.fn(), endSession: vi.fn() };
    const setupSession = () => {
        session.withTransaction.mockImplementation(async (fn) => fn());
        vi.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    };

    it('approves a pending request and notifies the borrower without refunding', async () => {
        const cookie = asLender();
        setupSession();
        vi.spyOn(Reservation, 'findById').mockResolvedValue(mockReservation({ status: 'pending' }));
        vi.spyOn(Reservation, 'findOneAndUpdate').mockResolvedValue({ _id: 'RES-1', status: 'upcoming' });
        const pay = vi.spyOn(Payment, 'create').mockResolvedValue([{}]);
        const notify = vi.spyOn(Notification, 'create').mockResolvedValue([{}]);

        const res = await request(app).patch(url).set('Origin', ORIGIN).set('Cookie', cookie);

        expect(res.status).toBe(200);
        expect(res.body.reservation.status).toBe('upcoming');
        expect(Reservation.findOneAndUpdate).toHaveBeenCalledWith(
            { _id: 'RES-1', lender: 'lender1', status: 'pending' },
            { $set: { status: 'upcoming' } },
            { new: true, session }
        );
        expect(User.updateOne).not.toHaveBeenCalled();
        expect(pay).not.toHaveBeenCalled();
        expect(notify).toHaveBeenCalledWith([expect.objectContaining({ username: 'borrower1' })], { session });
        expect(session.endSession).toHaveBeenCalled();
    });

    it('does not approve another lender reservation', async () => {
        const cookie = asLender();
        vi.spyOn(Reservation, 'findById').mockResolvedValue(mockReservation({ lender: 'lender2', status: 'pending' }));
        const start = vi.spyOn(mongoose, 'startSession');

        const res = await request(app).patch(url).set('Origin', ORIGIN).set('Cookie', cookie);

        expect(res.status).toBe(403);
        expect(start).not.toHaveBeenCalled();
    });
});

describe('PATCH /api/lender/reservations/:id/reject', () => {
    const url = '/api/lender/reservations/RES-1/reject';
    const session = { withTransaction: vi.fn(), endSession: vi.fn() };
    const setupSession = () => {
        session.withTransaction.mockImplementation(async (fn) => fn());
        vi.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    };

    it('rejects a pending request and refunds its deposit to the borrower wallet', async () => {
        const cookie = asLender();
        setupSession();
        vi.spyOn(Reservation, 'findById').mockResolvedValue(mockReservation({ status: 'pending' }));
        vi.spyOn(Reservation, 'findOneAndUpdate').mockResolvedValue({ _id: 'RES-1', status: 'rejected' });
        User.updateOne.mockResolvedValue({});
        const pay = vi.spyOn(Payment, 'create').mockResolvedValue([{}]);
        const notify = vi.spyOn(Notification, 'create').mockResolvedValue([{}]);

        const res = await request(app).patch(url).set('Origin', ORIGIN).set('Cookie', cookie);

        expect(res.status).toBe(200);
        expect(res.body.reservation.status).toBe('rejected');
        expect(res.body.refunded).toBe(100);
        expect(User.updateOne).toHaveBeenCalledWith({ _id: 'borrower1' }, { $inc: { wallet: 100 } }, { session });
        expect(pay).toHaveBeenCalledWith([expect.objectContaining({
            type: 'deposit-refund', amount: 100, direction: 'receive', method: 'wallet',
        })], { session });
        expect(notify).toHaveBeenCalledWith([expect.objectContaining({ username: 'borrower1' })], { session });
        expect(session.endSession).toHaveBeenCalled();
    });

    it('does not refund when a concurrent decision already changed the request', async () => {
        const cookie = asLender();
        setupSession();
        vi.spyOn(Reservation, 'findById').mockResolvedValue(mockReservation({ status: 'pending' }));
        vi.spyOn(Reservation, 'findOneAndUpdate').mockResolvedValue(null);
        const pay = vi.spyOn(Payment, 'create').mockResolvedValue([{}]);

        const res = await request(app).patch(url).set('Origin', ORIGIN).set('Cookie', cookie);

        expect(res.status).toBe(409);
        expect(User.updateOne).not.toHaveBeenCalled();
        expect(pay).not.toHaveBeenCalled();
        expect(session.endSession).toHaveBeenCalled();
    });

    it('rejects a direct reservation without crediting its uncollected deposit', async () => {
        const cookie = asLender();
        setupSession();
        vi.spyOn(Reservation, 'findById').mockResolvedValue(mockReservation({
            status: 'pending', payment: { depositAmount: 100, method: 'wallet', depositCollected: false }
        }));
        vi.spyOn(Reservation, 'findOneAndUpdate').mockResolvedValue({ _id: 'RES-1', status: 'rejected' });
        const pay = vi.spyOn(Payment, 'create');
        const notification = vi.spyOn(Notification, 'create').mockResolvedValue([{}]);

        const res = await request(app).patch(url).set('Origin', ORIGIN).set('Cookie', cookie);

        expect(res.status).toBe(200);
        expect(res.body.refunded).toBe(0);
        expect(User.updateOne).not.toHaveBeenCalled();
        expect(pay).not.toHaveBeenCalled();
        expect(notification).toHaveBeenCalledExactlyOnceWith([expect.objectContaining({
            message: 'Your reservation request was rejected.'
        })], { session });
    });
});

describe('PATCH /api/lender/reservations/:id/pickup', () => {
    const url = '/api/lender/reservations/RES-1/pickup';

    it('401 without cookie', async () => {
        const res = await request(app).patch(url).set('Origin', ORIGIN);
        expect(res.status).toBe(401);
    });

    it('403 for a member', async () => {
        User.findById.mockResolvedValue({ id: 'm1', role: 'member' });
        const res = await request(app).patch(url).set('Origin', ORIGIN).set('Cookie', `accessToken=${token('m1', 'member')}`);
        expect(res.status).toBe(403);
    });

    it('404 when reservation missing', async () => {
        const cookie = asLender();
        vi.spyOn(Reservation, 'findById').mockResolvedValue(null);
        const res = await request(app).patch(url).set('Origin', ORIGIN).set('Cookie', cookie);
        expect(res.status).toBe(404);
    });

    it('403 when reservation belongs to another lender', async () => {
        const cookie = asLender();
        const r = mockReservation({ lender: 'lender2' });
        vi.spyOn(Reservation, 'findById').mockResolvedValue(r);
        const res = await request(app).patch(url).set('Origin', ORIGIN).set('Cookie', cookie);
        expect(res.status).toBe(403);
        expect(r.save).not.toHaveBeenCalled();
    });

    it('409 when not upcoming', async () => {
        const cookie = asLender();
        vi.spyOn(Reservation, 'findById').mockResolvedValue(mockReservation({ status: 'pending' }));
        const res = await request(app).patch(url).set('Origin', ORIGIN).set('Cookie', cookie);
        expect(res.status).toBe(409);
    });

    it('200 sets status active and notifies borrower', async () => {
        const cookie = asLender();
        const r = mockReservation();
        vi.spyOn(Reservation, 'findById').mockResolvedValue(r);
        const res = await request(app).patch(url).set('Origin', ORIGIN).set('Cookie', cookie);
        expect(res.status).toBe(200);
        expect(res.body.reservation.status).toBe('active');
        expect(r.handover.pickedUpAt).toBeInstanceOf(Date);
        expect(r.save).toHaveBeenCalled();
        expect(notify).toHaveBeenCalledWith('borrower1', expect.objectContaining({
            type: 'other',
            reservation: 'RES-1',
            message: 'Your lender marked the item as picked up. Enjoy!',
        }));
    });
});

describe('PATCH /api/lender/reservations/:id/return', () => {
    const url = '/api/lender/reservations/RES-1/return';
    const session = { withTransaction: vi.fn(), endSession: vi.fn() };

    const setupSession = () => {
        session.withTransaction.mockImplementation(async (fn) => fn());
        vi.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    };

    it('409 when not active', async () => {
        const cookie = asLender();
        vi.spyOn(Reservation, 'findById').mockResolvedValue(mockReservation({ status: 'upcoming' }));
        const res = await request(app).patch(url).set('Origin', ORIGIN).set('Cookie', cookie);
        expect(res.status).toBe(409);
    });

    it('403 when reservation belongs to another lender', async () => {
        const cookie = asLender();
        vi.spyOn(Reservation, 'findById').mockResolvedValue(mockReservation({ status: 'active', lender: 'lender2' }));
        const start = vi.spyOn(mongoose, 'startSession');
        const res = await request(app).patch(url).set('Origin', ORIGIN).set('Cookie', cookie);
        expect(res.status).toBe(403);
        expect(start).not.toHaveBeenCalled();
    });

    it('200 completes reservation and refunds deposit to wallet', async () => {
        const cookie = asLender();
        setupSession();
        vi.spyOn(Reservation, 'findById').mockResolvedValue(mockReservation({ status: 'active' }));
        vi.spyOn(Reservation, 'findOneAndUpdate').mockResolvedValue({ _id: 'RES-1', status: 'completed', handover: { returnedAt: new Date(), returnCondition: 'good' } });
        User.updateOne.mockResolvedValue({});
        const pay = vi.spyOn(Payment, 'create').mockResolvedValue([{}]);

        const res = await request(app).patch(url).set('Origin', ORIGIN).set('Cookie', cookie);

        expect(res.status).toBe(200);
        expect(res.body.reservation.status).toBe('completed');
        expect(res.body.reservation.handover.returnCondition).toBe('good');
        expect(res.body.refunded).toBe(100);
        expect(User.updateOne).toHaveBeenCalledWith({ _id: 'borrower1' }, { $inc: { wallet: 100 } }, { session });
        expect(chargeLateFeeForReturn).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ _id: 'RES-1', status: 'completed' }), session
        );
        expect(pay).toHaveBeenCalledWith([expect.objectContaining({ type: 'deposit-refund', amount: 100, direction: 'receive' })], { session });
        expect(notify).toHaveBeenCalledWith('borrower1', expect.objectContaining({
            message: expect.stringContaining('deposit of 100'),
        }));
        expect(notifyWishlistItemAvailable).toHaveBeenCalledWith('ITM-1');
        expect(session.endSession).toHaveBeenCalled();
    });

    it('keeps late-fee handling for direct returns without refunding the uncollected deposit', async () => {
        const cookie = asLender();
        setupSession();
        vi.spyOn(Reservation, 'findById').mockResolvedValue(mockReservation({
            status: 'active', payment: { depositAmount: 100, method: 'wallet', depositCollected: false }
        }));
        const returned = { _id: 'RES-1', status: 'completed' };
        vi.spyOn(Reservation, 'findOneAndUpdate').mockResolvedValue(returned);
        const pay = vi.spyOn(Payment, 'create');

        const res = await request(app).patch(url).set('Origin', ORIGIN).set('Cookie', cookie);

        expect(res.status).toBe(200);
        expect(res.body.refunded).toBe(0);
        expect(chargeLateFeeForReturn).toHaveBeenCalledExactlyOnceWith(returned, session);
        expect(User.updateOne).not.toHaveBeenCalled();
        expect(pay).not.toHaveBeenCalled();
    });

    it('409 and no refund or late fee if already completed by a parallel request', async () => {
        const cookie = asLender();
        setupSession();
        vi.spyOn(Reservation, 'findById').mockResolvedValue(mockReservation({ status: 'active' }));
        vi.spyOn(Reservation, 'findOneAndUpdate').mockResolvedValue(null);
        const res = await request(app).patch(url).set('Origin', ORIGIN).set('Cookie', cookie);
        expect(res.status).toBe(409);
        expect(User.updateOne).not.toHaveBeenCalled();
        expect(chargeLateFeeForReturn).not.toHaveBeenCalled();
    });

    it('500 and no post-return notices when the transaction aborts after late-fee handling', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const cookie = asLender();
        setupSession();
        session.withTransaction.mockImplementation(async (callback) => {
            await callback();
            throw new Error('Commit failed');
        });
        vi.spyOn(Reservation, 'findById').mockResolvedValue(mockReservation({
            status: 'active', payment: { depositAmount: 0, method: 'wallet' }
        }));
        const returned = mockReservation({ status: 'completed' });
        vi.spyOn(Reservation, 'findOneAndUpdate').mockResolvedValue(returned);
        const res = await request(app).patch(url).set('Origin', ORIGIN).set('Cookie', cookie);
        expect(res.status).toBe(500);
        expect(res.body.message).toBe('Server Error');
        expect(chargeLateFeeForReturn).toHaveBeenCalledExactlyOnceWith(returned, session);
        expect(notify).not.toHaveBeenCalled();
        expect(notifyWishlistItemAvailable).not.toHaveBeenCalled();
        expect(session.endSession).toHaveBeenCalled();
    });
});

describe('reservation extension routes', () => {
    const endDate = '2030-07-10';

    it('passes a member request to the extension service', async () => {
        User.findById.mockResolvedValue({ _id: 'borrower1', role: 'member' });
        requestExtension.mockResolvedValue({ requestId: 'EXT-1', status: 'requested' });

        const res = await request(app).post('/api/reservations/RES-1/extensions')
            .set('Origin', ORIGIN).set('Cookie', `accessToken=${token('borrower1', 'member')}`)
            .send({ requestedEndDate: endDate });

        expect(res.status).toBe(201);
        expect(res.body).toEqual({ requestId: 'EXT-1', status: 'requested' });
        expect(requestExtension).toHaveBeenCalledExactlyOnceWith('RES-1', 'borrower1', endDate);
    });

    it('lists lender requests and passes a decision to the extension service', async () => {
        const cookie = asLender();
        getPendingExtensions.mockResolvedValue([{ requestId: 'EXT-1', status: 'requested' }]);
        decideExtension.mockResolvedValue({ requestId: 'EXT-1', status: 'accepted' });

        const list = await request(app).get('/api/lender/reservations/extensions/pending').set('Cookie', cookie);
        expect(list.status).toBe(200);
        expect(list.body).toEqual({ requests: [{ requestId: 'EXT-1', status: 'requested' }] });
        expect(getPendingExtensions).toHaveBeenCalledExactlyOnceWith('lender1');

        const decision = await request(app).patch('/api/lender/reservations/RES-1/extensions/EXT-1')
            .set('Origin', ORIGIN).set('Cookie', cookie).send({ decision: 'accept' });
        expect(decision.status).toBe(200);
        expect(decision.body).toEqual({ requestId: 'EXT-1', status: 'accepted' });
        expect(decideExtension).toHaveBeenCalledExactlyOnceWith('RES-1', 'EXT-1', 'lender1', 'accept');
    });
});

describe('POST /api/lender/reservations/:id/photos/:stage', () => {
    const urlFor = (stage) => `/api/lender/reservations/RES-1/photos/${stage}`;

    it('400 for an unknown stage', async () => {
        const cookie = asLender();
        const res = await request(app).post(urlFor('middle'))
            .set('Origin', ORIGIN).set('Cookie', cookie).attach('photos', Buffer.from('img'), 'a.jpg');
        expect(res.status).toBe(400);
    });

    it('400 without photos', async () => {
        const cookie = asLender();
        const res = await request(app).post(urlFor('pickup')).set('Origin', ORIGIN).set('Cookie', cookie);
        expect(res.status).toBe(400);
    });

    it('400 for a file that is not a JPG or PNG', async () => {
        const cookie = asLender();
        const res = await request(app).post(urlFor('pickup'))
            .set('Origin', ORIGIN).set('Cookie', cookie).attach('photos', Buffer.from('gif'), 'a.gif');
        expect(res.status).toBe(400);
        expect(uploadItemPhoto).not.toHaveBeenCalled();
    });

    it('403 when reservation belongs to another lender', async () => {
        const cookie = asLender();
        vi.spyOn(Reservation, 'findById').mockResolvedValue(mockReservation({ lender: 'lender2' }));
        const res = await request(app).post(urlFor('pickup'))
            .set('Origin', ORIGIN).set('Cookie', cookie).attach('photos', Buffer.from('img'), 'a.jpg');
        expect(res.status).toBe(403);
        expect(uploadItemPhoto).not.toHaveBeenCalled();
    });

    it('409 for return photos on an upcoming reservation', async () => {
        const cookie = asLender();
        vi.spyOn(Reservation, 'findById').mockResolvedValue(mockReservation());
        const res = await request(app).post(urlFor('return'))
            .set('Origin', ORIGIN).set('Cookie', cookie).attach('photos', Buffer.from('img'), 'a.jpg');
        expect(res.status).toBe(409);
        expect(uploadItemPhoto).not.toHaveBeenCalled();
    });

    it('400 when the stage would have more than 5 photos', async () => {
        const cookie = asLender();
        const fivePhotos = Array.from({ length: 5 }, (_, i) => ({ url: `https://img/${i}.jpg` }));
        vi.spyOn(Reservation, 'findById').mockResolvedValue(mockReservation({ handover: { pickupPhotos: fivePhotos, returnPhotos: [] } }));
        const res = await request(app).post(urlFor('pickup'))
            .set('Origin', ORIGIN).set('Cookie', cookie).attach('photos', Buffer.from('img'), 'a.jpg');
        expect(res.status).toBe(400);
        expect(uploadItemPhoto).not.toHaveBeenCalled();
    });

    it('200 adds pickup photos', async () => {
        const cookie = asLender();
        const r = mockReservation();
        vi.spyOn(Reservation, 'findById').mockResolvedValue(r);
        uploadItemPhoto.mockResolvedValue({ secure_url: 'https://img/1.jpg', public_id: 'p1' });
        const res = await request(app).post(urlFor('pickup'))
            .set('Origin', ORIGIN).set('Cookie', cookie).attach('photos', Buffer.from('img'), 'a.jpg');
        expect(res.status).toBe(200);
        expect(r.handover.pickupPhotos).toEqual([{ url: 'https://img/1.jpg' }]);
        expect(r.save).toHaveBeenCalled();
    });

    it('200 adds return photos on a completed reservation', async () => {
        const cookie = asLender();
        const r = mockReservation({ status: 'completed' });
        vi.spyOn(Reservation, 'findById').mockResolvedValue(r);
        uploadItemPhoto.mockResolvedValue({ secure_url: 'https://img/2.jpg', public_id: 'p2' });
        const res = await request(app).post(urlFor('return'))
            .set('Origin', ORIGIN).set('Cookie', cookie).attach('photos', Buffer.from('img'), 'a.png');
        expect(res.status).toBe(200);
        expect(r.handover.returnPhotos).toEqual([{ url: 'https://img/2.jpg' }]);
    });

    it('deletes uploaded photos when saving fails', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const cookie = asLender();
        const r = mockReservation({ save: vi.fn().mockRejectedValue(new Error('db')) });
        vi.spyOn(Reservation, 'findById').mockResolvedValue(r);
        uploadItemPhoto.mockResolvedValue({ secure_url: 'https://img/1.jpg', public_id: 'p1' });
        const res = await request(app).post(urlFor('pickup'))
            .set('Origin', ORIGIN).set('Cookie', cookie).attach('photos', Buffer.from('img'), 'a.jpg');
        expect(res.status).toBe(500);
        expect(deleteItemPhoto).toHaveBeenCalledWith('p1');
    });
});

describe('POST /api/lender/reservations/:id/damage', () => {
    const url = '/api/lender/reservations/RES-1/damage';
    const session = { withTransaction: vi.fn(), endSession: vi.fn() };
    const setupSession = () => {
        session.withTransaction.mockImplementation(async (fn) => fn());
        vi.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    };

    it('400 when message is missing', async () => {
        const cookie = asLender();
        const res = await request(app).post(url).set('Origin', ORIGIN).set('Cookie', cookie)
            .field('returnCondition', 'Scratched').attach('photos', Buffer.from('img'), 'a.jpg');
        expect(res.status).toBe(400);
    });

    it('400 when there are no new photos and no return photos', async () => {
        const cookie = asLender();
        vi.spyOn(Reservation, 'findById').mockResolvedValue(mockReservation({ status: 'active' }));
        const start = vi.spyOn(mongoose, 'startSession');
        const res = await request(app).post(url).set('Origin', ORIGIN).set('Cookie', cookie)
            .field('returnCondition', 'Scratched').field('message', 'Lens scratched');
        expect(res.status).toBe(400);
        expect(res.body.message).toBe('Please add at least one photo of the damage');
        expect(start).not.toHaveBeenCalled();
    });

    it('400 when return photos plus new photos would be more than 5', async () => {
        const cookie = asLender();
        const fourPhotos = Array.from({ length: 4 }, (_, i) => ({ url: `https://img/${i}.jpg` }));
        vi.spyOn(Reservation, 'findById').mockResolvedValue(
            mockReservation({ status: 'active', handover: { pickupPhotos: [], returnPhotos: fourPhotos } })
        );
        const res = await request(app).post(url).set('Origin', ORIGIN).set('Cookie', cookie)
            .field('returnCondition', 'Scratched').field('message', 'Lens scratched')
            .attach('photos', Buffer.from('img'), 'a.jpg').attach('photos', Buffer.from('img'), 'b.jpg');
        expect(res.status).toBe(400);
        expect(uploadItemPhoto).not.toHaveBeenCalled();
    });

    it('201 uses the existing return photos when no new photos are sent', async () => {
        const cookie = asLender();
        setupSession();
        const returnPhotos = [{ url: 'https://img/r1.jpg' }];
        vi.spyOn(Reservation, 'findById').mockResolvedValue(
            mockReservation({ status: 'active', handover: { pickupPhotos: [], returnPhotos } })
        );
        vi.spyOn(Reservation, 'findOneAndUpdate').mockResolvedValue({ _id: 'RES-1', status: 'completed', handover: { returnPhotos } });
        const create = vi.spyOn(DamageReport, 'create').mockResolvedValue([{ _id: 'DMG-1', type: 'report' }]);

        const res = await request(app).post(url).set('Origin', ORIGIN).set('Cookie', cookie)
            .field('returnCondition', 'Scratched').field('message', 'Lens scratched');

        expect(res.status).toBe(201);
        expect(uploadItemPhoto).not.toHaveBeenCalled();
        expect(create).toHaveBeenCalledWith([expect.objectContaining({
            report: { photos: [{ url: 'https://img/r1.jpg' }], message: 'Lens scratched' },
        })], { session });
        expect(chargeLateFeeForReturn).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ _id: 'RES-1', status: 'completed' }), session
        );
        expect(notify).toHaveBeenCalledWith('borrower1', expect.objectContaining({
            message: expect.stringContaining('damaged'),
        }));
        expect(notifyWishlistItemAvailable).toHaveBeenCalledWith('ITM-1');
    });

    it('409 when reservation is not active', async () => {
        const cookie = asLender();
        vi.spyOn(Reservation, 'findById').mockResolvedValue(mockReservation({ status: 'completed' }));
        const res = await request(app).post(url).set('Origin', ORIGIN).set('Cookie', cookie)
            .field('returnCondition', 'Scratched').field('message', 'Lens scratched')
            .attach('photos', Buffer.from('img'), 'a.jpg');
        expect(res.status).toBe(409);
        expect(uploadItemPhoto).not.toHaveBeenCalled();
    });

    it('201 adds new photos to the return photos, puts all of them in the report, and does not refund', async () => {
        const cookie = asLender();
        setupSession();
        vi.spyOn(Reservation, 'findById').mockResolvedValue(
            mockReservation({ status: 'active', handover: { pickupPhotos: [], returnPhotos: [{ url: 'https://img/r1.jpg' }] } })
        );
        // what the database returns after the $push: the old return photo plus the new one
        const update = vi.spyOn(Reservation, 'findOneAndUpdate').mockResolvedValue({
            _id: 'RES-1', status: 'completed',
            handover: { returnPhotos: [{ url: 'https://img/r1.jpg' }, { url: 'https://img/d.jpg' }] },
        });
        uploadItemPhoto.mockResolvedValue({ secure_url: 'https://img/d.jpg', public_id: 'd1' });
        const create = vi.spyOn(DamageReport, 'create').mockResolvedValue([{ _id: 'DMG-1', type: 'report' }]);
        const pay = vi.spyOn(Payment, 'create');

        const res = await request(app).post(url).set('Origin', ORIGIN).set('Cookie', cookie)
            .field('returnCondition', 'Scratched').field('message', 'Lens scratched')
            .attach('photos', Buffer.from('img'), 'a.jpg');

        expect(res.status).toBe(201);
        expect(res.body.report._id).toBe('DMG-1');
        expect(update).toHaveBeenCalledWith(
            { _id: 'RES-1', status: 'active' },
            {
                $set: expect.objectContaining({ status: 'completed', 'handover.returnCondition': 'damaged' }),
                $push: { 'handover.returnPhotos': { $each: [{ url: 'https://img/d.jpg' }] } },
            },
            expect.objectContaining({ session })
        );
        expect(create).toHaveBeenCalledWith([expect.objectContaining({
            reservation: 'RES-1',
            type: 'report',
            returnCondition: 'Scratched',
            report: { photos: [{ url: 'https://img/r1.jpg' }, { url: 'https://img/d.jpg' }], message: 'Lens scratched' },
        })], { session });
        expect(notify).toHaveBeenCalledWith('borrower1', expect.objectContaining({
            message: expect.stringContaining('damaged'),
        }));
        expect(notifyWishlistItemAvailable).toHaveBeenCalledWith('ITM-1');
        expect(User.updateOne).not.toHaveBeenCalled();
        expect(pay).not.toHaveBeenCalled();
        expect(rewardReferralIfEligible).toHaveBeenCalledExactlyOnceWith('borrower1', 'RES-1', session);
        expect(session.endSession).toHaveBeenCalled();
    });

    it('409 and deletes photos if a parallel request already closed it', async () => {
        const cookie = asLender();
        setupSession();
        vi.spyOn(Reservation, 'findById').mockResolvedValue(mockReservation({ status: 'active' }));
        vi.spyOn(Reservation, 'findOneAndUpdate').mockResolvedValue(null);
        uploadItemPhoto.mockResolvedValue({ secure_url: 'https://img/d.jpg', public_id: 'd1' });
        const create = vi.spyOn(DamageReport, 'create');
        const res = await request(app).post(url).set('Origin', ORIGIN).set('Cookie', cookie)
            .field('returnCondition', 'Scratched').field('message', 'Lens scratched')
            .attach('photos', Buffer.from('img'), 'a.jpg');
        expect(res.status).toBe(409);
        expect(create).not.toHaveBeenCalled();
        expect(chargeLateFeeForReturn).not.toHaveBeenCalled();
        expect(rewardReferralIfEligible).not.toHaveBeenCalled();
        expect(deleteItemPhoto).toHaveBeenCalledWith('d1');
    });

    it('500 and deletes photos when the transaction fails', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const cookie = asLender();
        session.withTransaction.mockRejectedValue(new Error('db down'));
        vi.spyOn(mongoose, 'startSession').mockResolvedValue(session);
        vi.spyOn(Reservation, 'findById').mockResolvedValue(mockReservation({ status: 'active' }));
        uploadItemPhoto.mockResolvedValue({ secure_url: 'https://img/d.jpg', public_id: 'd1' });
        const res = await request(app).post(url).set('Origin', ORIGIN).set('Cookie', cookie)
            .field('returnCondition', 'Scratched').field('message', 'Lens scratched')
            .attach('photos', Buffer.from('img'), 'a.jpg');
        expect(res.status).toBe(500);
        expect(deleteItemPhoto).toHaveBeenCalledWith('d1');
        expect(session.endSession).toHaveBeenCalled();
    });
});
