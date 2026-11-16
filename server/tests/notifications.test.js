import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { Notification } from '../models/Notification.js';
import { requireAuth } from '../middleware/auth.js';

vi.mock('../models/Notification.js', () => ({
    Notification: { find: vi.fn(), countDocuments: vi.fn(), findOneAndUpdate: vi.fn() }
}));

vi.mock('../middleware/auth.js', async (importOriginal) => ({
    ...(await importOriginal()),
    requireAuth: vi.fn()
}));

const TRUSTED_ORIGIN = 'http://localhost:3000';
const notification = { _id: 'NOT-1a2b3c4d', username: 'yara', type: 'accepted', message: 'Confirmed', read: false };

beforeEach(() => {
    vi.resetAllMocks();
    requireAuth.mockImplementation((req, res, next) => {
        req.user = { id: 'yara', role: 'member' };
        next();
    });
    Notification.find.mockResolvedValue([notification]);
    Notification.countDocuments.mockResolvedValue(1);
    Notification.findOneAndUpdate.mockResolvedValue({ ...notification, read: true });
});

describe('GET /api/notifications', () => {
    it('lists only my notifications, newest first, with pagination', async () => {
        const res = await request(app).get('/api/notifications?page=2&limit=5');

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            notifications: [notification],
            pagination: { total: 1, page: 2, totalPages: 1, limit: 5 }
        });
        const [filter, , options] = Notification.find.mock.calls[0];
        expect(filter).toEqual({ username: 'yara' });
        expect(options).toMatchObject({ sort: { createdAt: -1, _id: 1 }, skip: 5, limit: 5 });
        expect(Notification.countDocuments).toHaveBeenCalledWith({ username: 'yara' });
    });

    // no unread filter yet, so ?unread= is rejected like any unknown param
    it.each(['limit=51', 'page=0', 'unread=true'])('rejects ?%s with 400', async (query) => {
        const res = await request(app).get(`/api/notifications?${query}`);

        expect(res.status).toBe(400);
        expect(Notification.find).not.toHaveBeenCalled();
    });

    it('needs a login', async () => {
        requireAuth.mockImplementation((req, res) => res.status(401).json({ message: 'Authentication required' }));

        const res = await request(app).get('/api/notifications');

        expect(res.status).toBe(401);
    });
});

describe('PATCH /api/notifications/:id/read', () => {
    it('marks my notification as read', async () => {
        const res = await request(app).patch('/api/notifications/NOT-1a2b3c4d/read').set('Origin', TRUSTED_ORIGIN);

        expect(res.status).toBe(200);
        expect(res.body.notification.read).toBe(true);
        const [filter, update, options] = Notification.findOneAndUpdate.mock.calls[0];
        expect(filter).toEqual({ _id: 'NOT-1a2b3c4d', username: 'yara' });
        expect(update).toEqual({ $set: { read: true } });
        expect(options).toMatchObject({ returnDocument: 'after', lean: true });
    });

    // the query filters by username, so someone else's id finds nothing, same as a made up one
    it('404s for someone else\'s notification', async () => {
        Notification.findOneAndUpdate.mockResolvedValue(null);

        const res = await request(app).patch('/api/notifications/NOT-99999999/read').set('Origin', TRUSTED_ORIGIN);

        expect(res.status).toBe(404);
        expect(res.body).toEqual({ message: 'Notification not found' });
    });
});
