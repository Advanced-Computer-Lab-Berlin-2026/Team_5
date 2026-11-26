import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../app.js';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { Reservation } from '../models/Reservation.js';
import { Payment } from '../models/Payment.js';
import { DamageReport } from '../models/DamageReport.js';
import { uploadItemPhoto, deleteItemPhoto } from '../services/itemPhotoStorage.js';
import { notify, notifyWishlistItemAvailable } from '../services/notificationService.js';

vi.mock('../models/User.js', () => ({
    User: { findById: vi.fn(), updateOne: vi.fn() }
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
    notify.mockResolvedValue({});
    notifyWishlistItemAvailable.mockResolvedValue(undefined);
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
        expect(pay).toHaveBeenCalledWith([expect.objectContaining({ type: 'deposit-refund', amount: 100, direction: 'receive' })], { session });
        expect(notify).toHaveBeenCalledWith('borrower1', expect.objectContaining({
            message: expect.stringContaining('deposit of 100'),
        }));
        expect(notifyWishlistItemAvailable).toHaveBeenCalledWith('ITM-1');
        expect(session.endSession).toHaveBeenCalled();
    });

    it('409 and no refund if already completed by a parallel request', async () => {
        const cookie = asLender();
        setupSession();
        vi.spyOn(Reservation, 'findById').mockResolvedValue(mockReservation({ status: 'active' }));
        vi.spyOn(Reservation, 'findOneAndUpdate').mockResolvedValue(null);
        const res = await request(app).patch(url).set('Origin', ORIGIN).set('Cookie', cookie);
        expect(res.status).toBe(409);
        expect(User.updateOne).not.toHaveBeenCalled();
    });

    it('500 when the transaction fails', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const cookie = asLender();
        session.withTransaction.mockRejectedValue(new Error('db down'));
        vi.spyOn(mongoose, 'startSession').mockResolvedValue(session);
        vi.spyOn(Reservation, 'findById').mockResolvedValue(mockReservation({ status: 'active' }));
        const res = await request(app).patch(url).set('Origin', ORIGIN).set('Cookie', cookie);
        expect(res.status).toBe(500);
        expect(res.body.message).toBe('Server Error');
        expect(session.endSession).toHaveBeenCalled();
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