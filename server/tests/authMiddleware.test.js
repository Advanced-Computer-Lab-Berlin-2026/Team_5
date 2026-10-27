import { describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

// Tests for middleware/auth.js. requireAuth only verifies the JWT, so no database is needed.

const token = jwt.sign({ id: 'martin', role: 'member' }, env.jwtSecret, { expiresIn: '15m' });

// Fake Express objects so the middleware can be called directly, without a server
const fakeReq = cookies => ({ cookies: cookies ?? {} });
const fakeRes = () => {
    const res = {};
    res.status = vi.fn(() => res);
    res.json = vi.fn(() => res);
    return res;
};

// Calls the middleware with the given cookies (as cookie-parser would put them on req.cookies)
const run = (middleware, cookies) => {
    const req = fakeReq(cookies);
    const res = fakeRes();
    const next = vi.fn();
    middleware(req, res, next);
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

describe('requireAuth', () => {
    describe('valid token', () => {
        it('stores id and role on req.user from the accessToken cookie', () => {
            const { req, res, next } = run(requireAuth, { accessToken: token });
            // the user id is the username
            expect(req.user).toEqual({ id: 'martin', role: 'member' });
            expect(next).toHaveBeenCalledExactlyOnceWith();
            expect(res.status).not.toHaveBeenCalled();
        });
    });

    describe('missing token', () => {
        it.each([
            undefined,
            {},
            { accessToken: '' },
            // the refresh token alone must not log anyone in
            { refreshToken: 'a'.repeat(64) }
        ])('returns 401 Authentication required %#', cookies => {
            const { req, res, next } = run(requireAuth, cookies);
            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({ message: 'Authentication required' });
            expect(next).not.toHaveBeenCalled();
            expect(req.user).toBeUndefined();
        });
    });

    describe('expired token', () => {
        // the client should call POST /api/auth/refresh and retry
        it('returns 401 with code TOKEN_EXPIRED', () => {
            const expired = jwt.sign({ id: 'martin', role: 'member' }, env.jwtSecret, { expiresIn: -1 });
            const { res, next } = run(requireAuth, { accessToken: expired });
            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({ message: 'Access token expired', code: 'TOKEN_EXPIRED' });
            expect(next).not.toHaveBeenCalled();
        });
    });

    describe('invalid token', () => {
        it.each([
            'not-a-jwt',
            jwt.sign({ id: 'martin' }, 'wrong-secret'),
            jwt.sign({ id: 'martin' }, env.jwtSecret, { algorithm: 'HS512' }),
            jwt.sign({ role: 'member' }, env.jwtSecret) // no id
        ])('returns 401 Invalid access token %#', accessToken => {
            const { req, res, next } = run(requireAuth, { accessToken });
            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({ message: 'Invalid access token' });
            expect(next).not.toHaveBeenCalled();
            expect(req.user).toBeUndefined();
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
