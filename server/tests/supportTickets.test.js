import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../app.js';
import { env } from '../config/env.js';
import { SupportTicket } from '../models/SupportTicket.js';
import { User } from '../models/User.js';

vi.mock('../models/SupportTicket.js', () => ({
    SupportTicket: {
        create: vi.fn(),
        find: vi.fn(),
        findOneAndUpdate: vi.fn(),
        exists: vi.fn(),
    },
}));

vi.mock('../models/User.js', () => ({ User: { findById: vi.fn() } }));

const ORIGIN = 'http://localhost:3000';
const token = (id) => jwt.sign({ id }, env.jwtSecret, { expiresIn: '15m' });

function cookieFor(id, role) {
    User.findById.mockResolvedValue({ _id: id, role, suspended: false });
    return `accessToken=${token(id)}`;
}

beforeEach(() => {
    vi.resetAllMocks();
});

describe('POST /api/support-tickets', () => {
    it('creates a ticket for the signed-in member with their initial message', async () => {
        const cookie = cookieFor('member1', 'member');
        SupportTicket.create.mockResolvedValue({ _id: 'TKT-1', status: 'in-progress' });

        const response = await request(app).post('/api/support-tickets')
            .set('Origin', ORIGIN).set('Cookie', cookie)
            .send({ subject: 'Unable to reserve', message: 'The checkout button is not working.' });

        expect(response.status).toBe(201);
        expect(SupportTicket.create).toHaveBeenCalledWith({
            user: 'member1',
            subject: 'Unable to reserve',
            status: 'in-progress',
            messages: [{ sender: 'member1', userType: 'member', text: 'The checkout button is not working.' }],
        });
    });

    it('rejects invalid ticket details', async () => {
        const cookie = cookieFor('member1', 'member');

        const response = await request(app).post('/api/support-tickets')
            .set('Origin', ORIGIN).set('Cookie', cookie)
            .send({ subject: 'x', message: '' });

        expect(response.status).toBe(400);
        expect(SupportTicket.create).not.toHaveBeenCalled();
    });

    it('allows only members to submit tickets', async () => {
        const cookie = cookieFor('admin1', 'admin');

        const response = await request(app).post('/api/support-tickets')
            .set('Origin', ORIGIN).set('Cookie', cookie)
            .send({ subject: 'Need help', message: 'Please help.' });

        expect(response.status).toBe(403);
        expect(SupportTicket.create).not.toHaveBeenCalled();
    });
});

describe('GET /api/support-tickets', () => {
    it('lists only the signed-in member tickets with their status and messages', async () => {
        const cookie = cookieFor('member1', 'member');
        const tickets = [{ _id: 'TKT-1', user: 'member1', status: 'resolved', messages: [] }];
        const query = { sort: vi.fn(), lean: vi.fn().mockResolvedValue(tickets) };
        query.sort.mockReturnValue(query);
        SupportTicket.find.mockReturnValue(query);

        const response = await request(app).get('/api/support-tickets').set('Cookie', cookie);

        expect(response.status).toBe(200);
        expect(response.body.tickets).toEqual(tickets);
        expect(SupportTicket.find).toHaveBeenCalledWith({ user: 'member1' });
    });
});

describe('GET /api/admin/support-tickets', () => {
    it('lists tickets and filters by status for admins', async () => {
        const cookie = cookieFor('admin1', 'admin');
        const query = { sort: vi.fn(), populate: vi.fn(), lean: vi.fn().mockResolvedValue([]) };
        query.sort.mockReturnValue(query);
        query.populate.mockReturnValue(query);
        SupportTicket.find.mockReturnValue(query);

        const response = await request(app).get('/api/admin/support-tickets?status=resolved')
            .set('Cookie', cookie);

        expect(response.status).toBe(200);
        expect(SupportTicket.find).toHaveBeenCalledWith({ status: 'resolved' });
        expect(query.populate).toHaveBeenCalledWith('user', 'username profile.name profile.email');
    });

    it('rejects an unsupported status filter', async () => {
        const cookie = cookieFor('admin1', 'admin');

        const response = await request(app).get('/api/admin/support-tickets?status=pending')
            .set('Cookie', cookie);

        expect(response.status).toBe(400);
        expect(SupportTicket.find).not.toHaveBeenCalled();
    });
});

describe('POST /api/admin/support-tickets/:id/respond', () => {
    const url = '/api/admin/support-tickets/TKT-1/respond';

    it('replies to an open ticket and leaves it in progress', async () => {
        const cookie = cookieFor('admin1', 'admin');
        SupportTicket.findOneAndUpdate.mockResolvedValue({ _id: 'TKT-1', status: 'in-progress' });

        const response = await request(app).post(url)
            .set('Origin', ORIGIN).set('Cookie', cookie)
            .send({ message: 'We are looking into this.' });

        expect(response.status).toBe(200);
        expect(SupportTicket.findOneAndUpdate).toHaveBeenCalledWith(
            { _id: 'TKT-1', status: 'in-progress' },
            {
                $set: { respondedBy: 'admin1' },
                $push: { messages: { sender: 'admin1', userType: 'admin', text: 'We are looking into this.', seen: false } },
            },
            { new: true, runValidators: true }
        );
    });

    it('can reply and resolve a ticket in one action', async () => {
        const cookie = cookieFor('admin1', 'admin');
        SupportTicket.findOneAndUpdate.mockResolvedValue({ _id: 'TKT-1', status: 'resolved' });

        const response = await request(app).post(url)
            .set('Origin', ORIGIN).set('Cookie', cookie)
            .send({ message: 'This issue is fixed.', resolve: true });

        expect(response.status).toBe(200);
        expect(SupportTicket.findOneAndUpdate.mock.calls[0][1].$set).toEqual({
            respondedBy: 'admin1', status: 'resolved',
        });
    });

    it('returns 409 when the ticket is already resolved', async () => {
        const cookie = cookieFor('admin1', 'admin');
        SupportTicket.findOneAndUpdate.mockResolvedValue(null);
        SupportTicket.exists.mockResolvedValue(true);

        const response = await request(app).post(url)
            .set('Origin', ORIGIN).set('Cookie', cookie)
            .send({ message: 'A reply.' });

        expect(response.status).toBe(409);
        expect(SupportTicket.exists).toHaveBeenCalledWith({ _id: 'TKT-1' });
    });
});