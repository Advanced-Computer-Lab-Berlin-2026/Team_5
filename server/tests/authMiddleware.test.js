import { beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

// Tests for middleware/auth.js. The User model is mocked, so no database is needed.
vi.mock('../models/User.js', () => ({ User: { findById: vi.fn() } }));

const martin = { _id: 'martin', username: 'martin', role: 'member', suspended: false };
const token = jwt.sign({ id: 'martin', username: 'martin' }, env.jwtSecret, { expiresIn: '15m' });

// Fake Express objects so the middleware can be called directly, without a server
const fakeReq = authorization => ({ headers: authorization ? { authorization } : {} });
const fakeRes = () => {
    const res = {};
    res.status = vi.fn(() => res);
    res.json = vi.fn(() => res);
    return res;
};

// Calls the middleware with the given Authorization header
const run = async (middleware, authorization) => {
    const req = fakeReq(authorization);
    const res = fakeRes();
    const next = vi.fn();
    await middleware(req, res, next);
    return { req, res, next };
};

// Calls requireRole(...roles) for a request whose logged-in user is `user`
const runRole = (roles, user) => {
    const req = { user };
    const res = fakeRes();
    const next = vi.fn();
    requireRole(...roles)(req, res, next);
    return { res, next };
};

beforeEach(() => {
    vi.resetAllMocks();
    User.findById.mockResolvedValue(martin);
});

describe('requireAuth', () => {
    describe('valid token', () => {
        it('loads the user and stores id, username and role on req.user', async () => {
            const { req, res, next } = await run(requireAuth, `Bearer ${token}`);
            expect(User.findById).toHaveBeenCalledWith('martin');
            expect(req.user).toEqual({ id: 'martin', username: 'martin', role: 'member' });
            expect(next).toHaveBeenCalledExactlyOnceWith();
            expect(res.status).not.toHaveBeenCalled();
        });

        // the role comes from the database, so an admin's change applies immediately
        it('uses the current role from the database', async () => {
            User.findById.mockResolvedValue({ ...martin, role: 'lender' });
            const { req } = await run(requireAuth, `Bearer ${token}`);
            expect(req.user.role).toBe('lender');
        });
    });

    describe('missing or bad token', () => {
        it.each([
            undefined,
            'Bearer',
            'Basic abc',
            'Bearer not-a-jwt',
            `Bearer ${jwt.sign({ id: 'martin' }, 'wrong-secret')}`,
            `Bearer ${jwt.sign({ id: 'martin' }, env.jwtSecret, { expiresIn: -1 })}` // expired
        ])('returns 401 %#', async authorization => {
            const { res, next } = await run(requireAuth, authorization);
            expect(res.status).toHaveBeenCalledWith(401);
            expect(next).not.toHaveBeenCalled();
            expect(User.findById).not.toHaveBeenCalled();
        });
    });

    describe('user checks', () => {
        it('returns 401 when the user was deleted', async () => {
            User.findById.mockResolvedValue(null);
            const { req, res, next } = await run(requireAuth, `Bearer ${token}`);
            expect(res.status).toHaveBeenCalledWith(401);
            expect(next).not.toHaveBeenCalled();
            expect(req.user).toBeUndefined();
        });

        it('returns 403 when the user is suspended', async () => {
            User.findById.mockResolvedValue({ ...martin, suspended: true });
            const { res, next } = await run(requireAuth, `Bearer ${token}`);
            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ message: 'Your account is suspended' });
            expect(next).not.toHaveBeenCalled();
        });

        // the error goes to errorHandler, which answers 500
        it('passes database errors to next', async () => {
            const error = new Error('Database unavailable');
            User.findById.mockRejectedValue(error);
            const { res, next } = await run(requireAuth, `Bearer ${token}`);
            expect(next).toHaveBeenCalledExactlyOnceWith(error);
            expect(res.status).not.toHaveBeenCalled();
        });
    });
});

describe('requireRole', () => {
    const member = { id: 'martin', username: 'martin', role: 'member' };

    describe('allowed', () => {
        it('lets a user with the right role through', () => {
            const { res, next } = runRole(['admin'], { ...member, role: 'admin' });
            expect(next).toHaveBeenCalledOnce();
            expect(res.status).not.toHaveBeenCalled();
        });

        it.each(['member', 'lender', 'admin'])('accepts %s when several roles are allowed', role => {
            const { next } = runRole(['member', 'lender', 'admin'], { ...member, role });
            expect(next).toHaveBeenCalledOnce();
        });
    });

    describe('blocked', () => {
        it.each([
            [['admin'], 'member'],
            [['admin'], 'lender'],
            [['lender'], 'member'],
            [['lender', 'admin'], 'member']
        ])('allowed %j blocks a %s with 403', (roles, role) => {
            const { res, next } = runRole(roles, { ...member, role });
            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ message: 'You do not have permission to do this' });
            expect(next).not.toHaveBeenCalled();
        });

        // happens if requireAuth was forgotten before requireRole
        it.each([undefined, null])('returns 401 when nobody is logged in (req.user = %s)', user => {
            const { res, next } = runRole(['member'], user);
            expect(res.status).toHaveBeenCalledWith(401);
            expect(next).not.toHaveBeenCalled();
        });
    });
});