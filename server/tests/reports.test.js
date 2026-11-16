import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../app.js';
import { env } from '../config/env.js';
import { Item } from '../models/Item.js';
import { RefreshSession } from '../models/RefreshSession.js';
import { Report } from '../models/Report.js';
import { User } from '../models/User.js';
import { deleteUserAccount } from '../services/userAccountService.js';

vi.mock('../models/Item.js', () => ({
    Item: { findById: vi.fn(), findOneAndUpdate: vi.fn() },
}));

vi.mock('../models/RefreshSession.js', () => ({
    RefreshSession: { deleteMany: vi.fn() },
}));

vi.mock('../models/Report.js', () => ({
    Report: { create: vi.fn(), find: vi.fn(), findById: vi.fn(), findOneAndUpdate: vi.fn() },
}));

vi.mock('../models/User.js', () => ({
    User: { findById: vi.fn() },
}));

vi.mock('../services/userAccountService.js', () => ({
    deleteUserAccount: vi.fn(),
}));

const ORIGIN = 'http://localhost:3000';
const token = (id) => jwt.sign({ id }, env.jwtSecret, { expiresIn: '15m' });
const session = { withTransaction: vi.fn(), endSession: vi.fn() };

function authenticateAs(id, role) {
    User.findById.mockImplementation(async (userId) => {
        if (userId === id) return { _id: id, role, suspended: false };
        if (userId === 'target') return { _id: 'target', role: 'member', suspended: false, save: vi.fn().mockResolvedValue(true) };
        return null;
    });
    return `accessToken=${token(id)}`;
}

function setupSession() {
    session.withTransaction.mockImplementation(async (callback) => callback());
    vi.spyOn(mongoose, 'startSession').mockResolvedValue(session);
}

beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    session.withTransaction.mockImplementation(async (callback) => callback());
    User.findById.mockImplementation(async (id) => ({ _id: id, role: 'member', suspended: false }));
    RefreshSession.deleteMany.mockResolvedValue({ deletedCount: 1 });
});

describe('POST /api/reports', () => {
    it('lets a member report an item', async () => {
        const cookie = authenticateAs('member1', 'member');
        Item.findById.mockResolvedValue({ _id: 'ITM-1' });
        Report.create.mockResolvedValue({ _id: 'RPT-1', targetType: 'item', status: 'open' });

        const response = await request(app).post('/api/reports')
            .set('Origin', ORIGIN).set('Cookie', cookie)
            .send({ targetType: 'item', targetId: 'ITM-1', reason: 'Inappropriate listing' });

        expect(response.status).toBe(201);
        expect(Report.create).toHaveBeenCalledWith(expect.objectContaining({
            reporter: 'member1', targetType: 'item', targetItem: 'ITM-1', reason: 'Inappropriate listing',
        }));
    });

    it('lets a member report a user', async () => {
        const cookie = authenticateAs('member1', 'member');
        User.findById.mockImplementation(async (id) => id === 'member1'
            ? { _id: id, role: 'member', suspended: false }
            : { _id: id, role: 'member', suspended: false });
        Report.create.mockResolvedValue({ _id: 'RPT-2', targetType: 'user', status: 'open' });

        const response = await request(app).post('/api/reports')
            .set('Origin', ORIGIN).set('Cookie', cookie)
            .send({ targetType: 'user', targetId: 'member2', reason: 'Harassing other members' });

        expect(response.status).toBe(201);
        expect(Report.create).toHaveBeenCalledWith(expect.objectContaining({
            reporter: 'member1', targetType: 'user', targetUser: 'member2',
        }));
    });

    it('rejects invalid report input', async () => {
        const cookie = authenticateAs('member1', 'member');

        const response = await request(app).post('/api/reports')
            .set('Origin', ORIGIN).set('Cookie', cookie)
            .send({ targetType: 'reservation', targetId: 'RES-1', reason: 'bad' });

        expect(response.status).toBe(400);
        expect(Report.create).not.toHaveBeenCalled();
    });

    it('restricts reporting to members', async () => {
        const cookie = authenticateAs('admin1', 'admin');

        const response = await request(app).post('/api/reports')
            .set('Origin', ORIGIN).set('Cookie', cookie)
            .send({ targetType: 'item', targetId: 'ITM-1', reason: 'Inappropriate listing' });

        expect(response.status).toBe(403);
        expect(Report.create).not.toHaveBeenCalled();
    });
});

describe('GET /api/admin/reports', () => {
    it('lists open reports for admins', async () => {
        const cookie = authenticateAs('admin1', 'admin');
        const query = {
            sort: vi.fn(),
            populate: vi.fn(),
            lean: vi.fn().mockResolvedValue([{ _id: 'RPT-1', status: 'open' }]),
        };
        query.sort.mockReturnValue(query);
        query.populate.mockReturnValue(query);
        Report.find.mockReturnValue(query);

        const response = await request(app).get('/api/admin/reports').set('Cookie', cookie);

        expect(response.status).toBe(200);
        expect(response.body.reports).toHaveLength(1);
        expect(Report.find).toHaveBeenCalledWith({ status: 'open' });
    });
});

describe('PATCH /api/admin/reports/:id/decision', () => {
    it('flags a reported item so it is hidden publicly', async () => {
        const cookie = authenticateAs('admin1', 'admin');
        setupSession();
        Report.findById.mockResolvedValue({ _id: 'RPT-1', targetType: 'item', targetItem: 'ITM-1', status: 'open' });
        Report.findOneAndUpdate.mockResolvedValue({ _id: 'RPT-1', status: 'flagged' });
        Item.findOneAndUpdate.mockResolvedValue({ _id: 'ITM-1', flagged: true });

        const response = await request(app).patch('/api/admin/reports/RPT-1/decision')
            .set('Origin', ORIGIN).set('Cookie', cookie).send({ action: 'flag' });

        expect(response.status).toBe(200);
        expect(Item.findOneAndUpdate).toHaveBeenCalledWith(
            { _id: 'ITM-1' }, { $set: { flagged: true } }, { new: true, session }
        );
        expect(Report.findOneAndUpdate).toHaveBeenCalledWith(
            { _id: 'RPT-1', status: 'open' },
            { $set: { status: 'flagged', reviewedBy: 'admin1' } },
            { new: true, session }
        );
        expect(session.endSession).toHaveBeenCalled();
    });

    it('suspends a reported user and revokes their sessions when flagged', async () => {
        const cookie = authenticateAs('admin1', 'admin');
        setupSession();
        const target = { _id: 'target', role: 'member', suspended: false, save: vi.fn().mockResolvedValue(true) };
        User.findById.mockImplementation(async (id) => id === 'admin1'
            ? { _id: id, role: 'admin', suspended: false }
            : target);
        Report.findById.mockResolvedValue({ _id: 'RPT-1', targetType: 'user', targetUser: 'target', status: 'open' });
        Report.findOneAndUpdate.mockResolvedValue({ _id: 'RPT-1', status: 'flagged' });

        const response = await request(app).patch('/api/admin/reports/RPT-1/decision')
            .set('Origin', ORIGIN).set('Cookie', cookie).send({ action: 'flag' });

        expect(response.status).toBe(200);
        expect(target.suspended).toBe(true);
        expect(target.save).toHaveBeenCalledWith({ session });
        expect(RefreshSession.deleteMany).toHaveBeenCalledWith({ userId: 'target' }, { session });
    });

    it('soft-removes a reported item by archiving and flagging it', async () => {
        const cookie = authenticateAs('admin1', 'admin');
        setupSession();
        Report.findById.mockResolvedValue({ _id: 'RPT-1', targetType: 'item', targetItem: 'ITM-1', status: 'open' });
        Report.findOneAndUpdate.mockResolvedValue({ _id: 'RPT-1', status: 'removed' });
        Item.findOneAndUpdate.mockResolvedValue({ _id: 'ITM-1', flagged: true, archived: true });

        const response = await request(app).patch('/api/admin/reports/RPT-1/decision')
            .set('Origin', ORIGIN).set('Cookie', cookie).send({ action: 'remove' });

        expect(response.status).toBe(200);
        expect(Item.findOneAndUpdate).toHaveBeenCalledWith(
            { _id: 'ITM-1' }, { $set: { flagged: true, archived: true } }, { new: true, session }
        );
    });

    it('removes a reported user through the account cleanup service', async () => {
        const cookie = authenticateAs('admin1', 'admin');
        setupSession();
        Report.findById.mockResolvedValue({ _id: 'RPT-1', targetType: 'user', targetUser: 'target', status: 'open' });
        Report.findOneAndUpdate.mockResolvedValue({ _id: 'RPT-1', status: 'removed' });
        deleteUserAccount.mockResolvedValue(true);

        const response = await request(app).patch('/api/admin/reports/RPT-1/decision')
            .set('Origin', ORIGIN).set('Cookie', cookie).send({ action: 'remove' });

        expect(response.status).toBe(200);
        expect(deleteUserAccount).toHaveBeenCalledWith('target', session);
    });
});