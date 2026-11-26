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
import { closeExpiredDecisions } from '../services/damageCase.js';
import { notify } from '../services/notificationService.js';

vi.mock('../models/User.js', () => ({
    User: { findById: vi.fn(), updateOne: vi.fn() }
}));

vi.mock('../services/notificationService.js', () => ({
    notify: vi.fn(),
}));

vi.mock('../services/itemPhotoStorage.js', () => ({
    uploadItemPhoto: vi.fn(),
    deleteItemPhoto: vi.fn(),
}));

const ORIGIN = 'http://localhost:3000';
const CASE = 'DMG-0000000a';
const DAY_MS = 24 * 60 * 60 * 1000;
const ROLES = { admin1: 'admin', lender1: 'lender', borrower1: 'member', stranger1: 'member' };

// logs in as one of the users above
function as(id) {
    User.findById.mockImplementation(async (userId) => (ROLES[userId] ? { _id: userId, role: ROLES[userId], suspended: false } : null));
    return `accessToken=${jwt.sign({ id, role: ROLES[id] }, env.jwtSecret, { expiresIn: '15m' })}`;
}

const daysAgo = (days) => new Date(Date.now() - days * DAY_MS);

const mockReservation = (overrides = {}) => ({
    _id: 'RES-1', borrower: 'borrower1', lender: 'lender1', item: { name: 'PS5' },
    payment: { depositAmount: 2000 },
    handover: { pickupPhotos: [{ url: 'pickup1' }], returnPhotos: [{ url: 'return1' }, { url: 'return2' }] },
    ...overrides,
});

const step = (type, overrides = {}) => ({
    _id: type === 'report' ? CASE : `DMG-${type}`,
    reservation: 'RES-1',
    type,
    createdAt: daysAgo(1),
    report: { message: `${type} message`, photos: [], date: daysAgo(1) },
    ...overrides,
});

// Makes loadCase find a case with these steps. `expired` is what closeExpiredDecisions finds.
function mockCase(steps, { reservation = mockReservation(), expired = [] } = {}) {
    vi.spyOn(DamageReport, 'findOne').mockResolvedValue(steps[0]?.type === 'report' ? steps[0] : null);
    vi.spyOn(DamageReport, 'distinct').mockResolvedValue([]);
    vi.spyOn(DamageReport, 'find').mockImplementation((filter) => (
        filter.type === 'decision' ? Promise.resolve(expired) : { sort: vi.fn().mockResolvedValue(steps) }
    ));
    vi.spyOn(Reservation, 'findById').mockReturnValue({ populate: vi.fn().mockResolvedValue(reservation) });
}

// create() returns an array when it was given one, like Mongoose does (with timestamps)
const NOW = new Date('2026-11-26T10:00:00Z');
const mockCreate = () => vi.spyOn(DamageReport, 'create').mockImplementation(async (docs) => (
    Array.isArray(docs) ? docs.map((doc) => ({ _id: 'DMG-new', createdAt: NOW, ...doc })) : { _id: 'DMG-new', createdAt: NOW, ...docs }
));

const duplicateError = () => Object.assign(new Error('duplicate key'), { code: 11000 });

let session;
beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    session = { withTransaction: vi.fn(async (fn) => fn()), endSession: vi.fn() };
    vi.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    vi.spyOn(Payment, 'create').mockResolvedValue([{}]);
    User.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    notify.mockResolvedValue({});
});

describe('GET /api/admin/damage-reports/:id', () => {
    const url = `/api/admin/damage-reports/${CASE}`;

    it('401 without a cookie', async () => {
        const res = await request(app).get(url);
        expect(res.status).toBe(401);
    });

    it.each(['borrower1', 'lender1'])('403 for %s, who is not an admin', async (id) => {
        const res = await request(app).get(url).set('Cookie', as(id));
        expect(res.status).toBe(403);
    });

    it('400 for an id that is not a DMG id', async () => {
        const res = await request(app).get('/api/admin/damage-reports/RES-1').set('Cookie', as('admin1'));
        expect(res.status).toBe(400);
    });

    it('404 for an unknown case, or the id of a step that is not the report', async () => {
        mockCase([step('decision')]); // findOne finds no report with this id
        const res = await request(app).get(url).set('Cookie', as('admin1'));
        expect(res.status).toBe(404);
        expect(res.body.message).toBe('Damage case not found');
    });

    it('200 with the before and after photos and every step in order', async () => {
        mockCase([step('report'), step('decision', { depositForfeit: 500 })]);
        const res = await request(app).get(url).set('Cookie', as('admin1'));

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            id: CASE,
            status: 'decision',
            beforePhotos: [{ url: 'pickup1' }],
            afterPhotos: [{ url: 'return1' }, { url: 'return2' }],
        });
        expect(res.body.steps.map((s) => s.type)).toEqual(['report', 'decision']);
    });
});

describe('POST /api/admin/damage-reports/:id/decision', () => {
    const url = `/api/admin/damage-reports/${CASE}/decision`;
    const decide = (body) => request(app).post(url).set('Origin', ORIGIN).set('Cookie', as('admin1')).send(body);

    it('403 for a member', async () => {
        const res = await request(app).post(url).set('Origin', ORIGIN).set('Cookie', as('borrower1')).send({});
        expect(res.status).toBe(403);
    });

    it('400 when the message is missing', async () => {
        mockCase([step('report')]);
        const res = await decide({ depositForfeit: 500 });
        expect(res.status).toBe(400);
    });

    it('400 when the forfeit is more than the deposit', async () => {
        mockCase([step('report')]);
        const res = await decide({ depositForfeit: 2001, message: 'too much' });
        expect(res.status).toBe(400);
        expect(res.body.message).toBe('The forfeit cannot be more than the deposit');
    });

    it('400 when the forfeit has more than 2 decimals', async () => {
        mockCase([step('report')]);
        const res = await decide({ depositForfeit: 33.3333, message: 'a third' });
        expect(res.status).toBe(400);
        expect(res.body.message).toBe('"depositForfeit" must have no more than 2 decimal places');
        expect(User.updateOne).not.toHaveBeenCalled();
    });

    it('accepts an amount with 2 decimals and refunds the exact rest', async () => {
        mockCase([step('report')]);
        mockCreate();
        const res = await decide({ depositForfeit: 33.33, message: 'small scratch' });
        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({ toLender: 33.33, toBorrower: 1966.67 });
    });

    it('409 when the case already has a decision', async () => {
        mockCase([step('report'), step('decision', { depositForfeit: 500 })]);
        const res = await decide({ depositForfeit: 500, message: 'again' });
        expect(res.status).toBe(409);
    });

    it('notifies the borrower (with the dispute deadline) and the lender after the decision', async () => {
        mockCase([step('report')]);
        mockCreate();

        await decide({ depositForfeit: 500, message: 'Crack confirmed' });

        expect(notify).toHaveBeenCalledTimes(2);
        expect(notify).toHaveBeenCalledWith('borrower1', expect.objectContaining({
            reservation: 'RES-1',
            message: expect.stringMatching(/₥500 .*₥1500 .*dispute this until 3 Dec 2026/),
        }));
        expect(notify).toHaveBeenCalledWith('lender1', expect.objectContaining({
            reservation: 'RES-1',
            message: expect.stringContaining('₥500 of the deposit was added to your wallet'),
        }));
    });

    it('still answers 201 when a notification fails, the decision is already saved', async () => {
        mockCase([step('report')]);
        mockCreate();
        notify.mockRejectedValue(new Error('mail down'));
        vi.spyOn(console, 'error').mockImplementation(() => {});

        const res = await decide({ depositForfeit: 500, message: 'Crack confirmed' });

        expect(res.status).toBe(201);
    });

    it('404 and no Payment when the account was deleted', async () => {
        mockCase([step('report')]);
        mockCreate();
        User.updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });

        const res = await decide({ depositForfeit: 500, message: 'Crack confirmed' });

        expect(res.status).toBe(404);
        expect(res.body.message).toBe('User lender1 not found');
        expect(Payment.create).not.toHaveBeenCalled();
        expect(notify).not.toHaveBeenCalled();
    });

    it('201 saves the decision and moves the money in one transaction', async () => {
        mockCase([step('report')]);
        const create = mockCreate();

        const res = await decide({ depositForfeit: 500, message: 'Crack confirmed' });

        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({ toLender: 500, toBorrower: 1500, decision: { type: 'decision', depositForfeit: 500 } });
        expect(create).toHaveBeenCalledWith([expect.objectContaining({ type: 'decision', depositForfeit: 500 })], { session });
        expect(User.updateOne).toHaveBeenCalledWith({ _id: 'lender1' }, { $inc: { wallet: 500 } }, { session });
        expect(User.updateOne).toHaveBeenCalledWith({ _id: 'borrower1' }, { $inc: { wallet: 1500 } }, { session });
        expect(Payment.create).toHaveBeenCalledWith([expect.objectContaining({ user: 'lender1', type: 'deposit-forfeit', amount: 500, direction: 'receive' })], { session });
        expect(Payment.create).toHaveBeenCalledWith([expect.objectContaining({ user: 'borrower1', type: 'deposit-refund', amount: 1500, direction: 'receive' })], { session });
        expect(session.endSession).toHaveBeenCalled();
    });

    it('moves no money to the borrower when the whole deposit is kept', async () => {
        mockCase([step('report')]);
        mockCreate();

        await decide({ depositForfeit: 2000, message: 'Destroyed' });

        expect(User.updateOne).toHaveBeenCalledTimes(1);
        expect(User.updateOne).toHaveBeenCalledWith({ _id: 'lender1' }, { $inc: { wallet: 2000 } }, { session });
    });

    it('409 when a second click saved the decision first', async () => {
        mockCase([step('report')]);
        vi.spyOn(DamageReport, 'create').mockRejectedValue(duplicateError());

        const res = await decide({ depositForfeit: 500, message: 'double click' });

        expect(res.status).toBe(409);
        expect(session.endSession).toHaveBeenCalled();
    });
});

describe('POST /api/admin/damage-reports/:id/resolution', () => {
    const url = `/api/admin/damage-reports/${CASE}/resolution`;
    const resolve = (body) => request(app).post(url).set('Origin', ORIGIN).set('Cookie', as('admin1')).send(body);
    const disputedCase = () => mockCase([step('report'), step('decision', { depositForfeit: 500 }), step('dispute')]);

    it('409 when the case is not disputed', async () => {
        mockCase([step('report'), step('decision', { depositForfeit: 500 })]);
        const res = await resolve({ depositForfeit: 300, message: 'final' });
        expect(res.status).toBe(409);
        expect(res.body.message).toBe('Only a disputed case can be resolved');
    });

    it('a higher amount takes the difference from the borrower and gives it to the lender', async () => {
        disputedCase();
        mockCreate();

        const res = await resolve({ depositForfeit: 700, message: 'worse than thought' });

        expect(res.status).toBe(201);
        expect(res.body.difference).toBe(200);
        expect(User.updateOne).toHaveBeenCalledWith({ _id: 'borrower1' }, { $inc: { wallet: -200 } }, { session });
        expect(User.updateOne).toHaveBeenCalledWith({ _id: 'lender1' }, { $inc: { wallet: 200 } }, { session });
    });

    it('a lower amount takes the difference from the lender and gives it back to the borrower', async () => {
        disputedCase();
        mockCreate();

        const res = await resolve({ depositForfeit: 300, message: 'partly there at pickup' });

        expect(res.status).toBe(201);
        expect(res.body.difference).toBe(-200);
        expect(User.updateOne).toHaveBeenCalledWith({ _id: 'lender1' }, { $inc: { wallet: -200 } }, { session });
        expect(User.updateOne).toHaveBeenCalledWith({ _id: 'borrower1' }, { $inc: { wallet: 200 } }, { session });
    });

    it('the same amount saves the resolution and moves no money', async () => {
        disputedCase();
        const create = mockCreate();

        const res = await resolve({ depositForfeit: 500, message: 'decision stands' });

        expect(res.status).toBe(201);
        expect(create).toHaveBeenCalledWith([expect.objectContaining({ type: 'resolution', depositForfeit: 500 })], { session });
        expect(User.updateOne).not.toHaveBeenCalled();
    });

    it('goes through even if the payer spent their wallet: no balance check, the wallet may go negative', async () => {
        disputedCase();
        mockCreate();

        const res = await resolve({ depositForfeit: 700, message: 'worse' });

        expect(res.status).toBe(201);
        // no { wallet: { $gte } } filter, so an empty wallet becomes -200 instead of a stuck case
        expect(User.updateOne).toHaveBeenCalledWith({ _id: 'borrower1' }, { $inc: { wallet: -200 } }, { session });
        expect(Payment.create).toHaveBeenCalledWith([expect.objectContaining({ user: 'borrower1', amount: 200, direction: 'deduct' })], { session });
    });

    it('rounds the difference to cents', async () => {
        mockCase([step('report'), step('decision', { depositForfeit: 0.01 }), step('dispute')]);
        mockCreate();

        const res = await resolve({ depositForfeit: 33.33, message: 'a bit worse' });

        expect(res.body.difference).toBe(33.32);
    });

    it('notifies both sides of the final amount and what moved', async () => {
        disputedCase();
        mockCreate();

        await resolve({ depositForfeit: 300, message: 'partly there at pickup' });

        expect(notify).toHaveBeenCalledWith('borrower1', expect.objectContaining({
            message: expect.stringMatching(/final amount .* ₥300\. ₥200 was given back to your wallet/),
        }));
        expect(notify).toHaveBeenCalledWith('lender1', expect.objectContaining({
            message: expect.stringContaining('₥200 was taken from your wallet and given back to the borrower'),
        }));
    });

    it('notifies both sides when the decision stands', async () => {
        disputedCase();
        mockCreate();

        await resolve({ depositForfeit: 500, message: 'decision stands' });

        expect(notify).toHaveBeenCalledTimes(2);
        expect(notify).toHaveBeenCalledWith('borrower1', expect.objectContaining({ message: expect.stringContaining('Nothing changes in your wallet') }));
    });

    it('404 and no Payment when the payer\'s account was deleted', async () => {
        disputedCase();
        mockCreate();
        User.updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });

        const res = await resolve({ depositForfeit: 700, message: 'worse' });

        expect(res.status).toBe(404);
        expect(res.body.message).toBe('User borrower1 not found');
        expect(Payment.create).not.toHaveBeenCalled();
    });
});

describe('POST /api/damage-reports/:id/dispute', () => {
    const url = `/api/damage-reports/${CASE}/dispute`;
    const dispute = (id = 'borrower1') => request(app).post(url).set('Origin', ORIGIN).set('Cookie', as(id));
    const decidedCase = (decisionDate = daysAgo(1)) => mockCase([
        step('report'),
        step('decision', { depositForfeit: 500, createdAt: decisionDate }),
    ]);

    it('401 without a cookie', async () => {
        const res = await request(app).post(url).set('Origin', ORIGIN);
        expect(res.status).toBe(401);
    });

    it('400 when the message is missing', async () => {
        const res = await dispute().field('other', 'x');
        expect(res.status).toBe(400);
    });

    it('404 for someone who is not the borrower, so the case stays hidden', async () => {
        decidedCase();
        const res = await dispute('stranger1').field('message', 'not mine');
        expect(res.status).toBe(404);
        expect(res.body.message).toBe('Damage case not found');
    });

    it('409 before an admin decided the case', async () => {
        mockCase([step('report')]);
        const res = await dispute().field('message', 'too early');
        expect(res.status).toBe(409);
    });

    it('409 "already final" after the 7 days, and saves the automatic resolution', async () => {
        const oldDecision = step('decision', { depositForfeit: 500, createdAt: daysAgo(8) });
        const create = mockCreate();
        mockCase(
            [step('report'), oldDecision, step('resolution', { depositForfeit: 500 })],
            { expired: [oldDecision] }
        );

        const res = await dispute().field('message', 'too late');

        expect(res.status).toBe(409);
        expect(res.body.message).toBe('This case is already final');
        expect(create).toHaveBeenCalledWith(expect.objectContaining({ type: 'resolution', depositForfeit: 500 }));
    });

    it('201 saves the dispute with its photos', async () => {
        decidedCase();
        const create = mockCreate();
        uploadItemPhoto.mockResolvedValue({ secure_url: 'https://cdn/dispute1.jpg', public_id: 'dispute1' });

        const res = await dispute().field('message', 'The crack was there at pickup').attach('photos', Buffer.from('img'), 'a.jpg');

        expect(res.status).toBe(201);
        expect(create).toHaveBeenCalledWith({
            reservation: 'RES-1',
            type: 'dispute',
            report: { photos: [{ url: 'https://cdn/dispute1.jpg' }], message: 'The crack was there at pickup' },
        });
    });

    it('201 without photos too', async () => {
        decidedCase();
        mockCreate();
        const res = await dispute().field('message', 'I disagree');
        expect(res.status).toBe(201);
        expect(uploadItemPhoto).not.toHaveBeenCalled();
    });

    it('409 for a second dispute, and deletes the photos it just uploaded', async () => {
        decidedCase();
        vi.spyOn(DamageReport, 'create').mockRejectedValue(duplicateError());
        uploadItemPhoto.mockResolvedValue({ secure_url: 'https://cdn/x.jpg', public_id: 'x' });

        const res = await dispute().field('message', 'again').attach('photos', Buffer.from('img'), 'a.jpg');

        expect(res.status).toBe(409);
        expect(deleteItemPhoto).toHaveBeenCalledWith('x');
    });
});

describe('GET /api/damage-reports/:id/pdf', () => {
    const url = `/api/damage-reports/${CASE}/pdf`;
    const readBinary = (res, callback) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
    };

    it.each(['admin1', 'borrower1', 'lender1'])('downloads the PDF for %s', async (id) => {
        mockCase([step('report'), step('decision', { depositForfeit: 500 })]);

        const res = await request(app).get(url).set('Cookie', as(id)).buffer(true).parse(readBinary);

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe('application/pdf');
        expect(res.headers['content-disposition']).toBe(`attachment; filename="damage-case-${CASE}.pdf"`);
        expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('404 for any other logged-in user', async () => {
        mockCase([step('report')]);
        const res = await request(app).get(url).set('Cookie', as('stranger1'));
        expect(res.status).toBe(404);
    });

    it('400 for an id that is not a DMG id', async () => {
        const res = await request(app).get('/api/damage-reports/abc/pdf').set('Cookie', as('admin1'));
        expect(res.status).toBe(400);
    });
});

describe('closeExpiredDecisions', () => {
    it('saves a resolution with the same amount, dated when the 7 days ended, and moves no money', async () => {
        const decidedAt = daysAgo(8);
        const finalAt = new Date(decidedAt);
        finalAt.setDate(finalAt.getDate() + 7);
        vi.spyOn(DamageReport, 'distinct').mockResolvedValue([]);
        vi.spyOn(DamageReport, 'find').mockResolvedValue([step('decision', { depositForfeit: 500, createdAt: decidedAt })]);
        const create = mockCreate();

        await closeExpiredDecisions();

        expect(create).toHaveBeenCalledWith({
            reservation: 'RES-1',
            type: 'resolution',
            depositForfeit: 500,
            report: {
                message: 'No dispute within 7 days, the decision is final.',
                date: finalAt,
            },
        });
        expect(User.updateOne).not.toHaveBeenCalled();
        expect(Payment.create).not.toHaveBeenCalled();
    });

    it('only looks at decisions older than 7 days whose case has no dispute or resolution', async () => {
        vi.spyOn(DamageReport, 'distinct').mockResolvedValue(['RES-disputed']);
        const find = vi.spyOn(DamageReport, 'find').mockResolvedValue([]);

        await closeExpiredDecisions();

        expect(DamageReport.distinct).toHaveBeenCalledWith('reservation', { type: { $in: ['dispute', 'resolution'] } });
        const filter = find.mock.calls[0][0];
        expect(filter.type).toBe('decision');
        expect(filter.reservation).toEqual({ $nin: ['RES-disputed'] });
        expect(Date.now() - filter.createdAt.$lt.getTime()).toBeGreaterThanOrEqual(7 * DAY_MS - 1000);
    });

    it('checks only one case when given a reservation id', async () => {
        vi.spyOn(DamageReport, 'distinct').mockResolvedValue([]);
        const find = vi.spyOn(DamageReport, 'find').mockResolvedValue([]);

        await closeExpiredDecisions('RES-1');

        expect(DamageReport.distinct).toHaveBeenCalledWith('reservation', { reservation: 'RES-1', type: { $in: ['dispute', 'resolution'] } });
        expect(find.mock.calls[0][0].reservation).toEqual({ $eq: 'RES-1', $nin: [] });
    });

    it('skips a resolution that someone else saved a moment ago', async () => {
        vi.spyOn(DamageReport, 'distinct').mockResolvedValue([]);
        vi.spyOn(DamageReport, 'find').mockResolvedValue([step('decision', { depositForfeit: 500, createdAt: daysAgo(8) })]);
        vi.spyOn(DamageReport, 'create').mockRejectedValue(duplicateError());

        await expect(closeExpiredDecisions()).resolves.toBeUndefined();
    });
});
