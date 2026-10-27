import { authLimiters } from '../middleware/authSecurity.js';
import { afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import request from "supertest";
import app from "../app.js";
import { User, RefreshSession } from "../models/index.js";
import bcrypt from "bcrypt";
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

// Create a Mock model for User where this model has these 2 functions, findone and Create. (because i call them in my auth.js)
vi.mock('../models/User.js', () => ({
    User: {
        findById: vi.fn(),
        findOne: vi.fn(),
        create: vi.fn()
    }
}));

vi.mock('../models/RefreshSession.js', () => ({
    RefreshSession: { create: vi.fn(), deleteOne: vi.fn(), findOneAndDelete: vi.fn() }
}));

//Before each runs this lambda function before each test.
beforeEach( () => {
    // resets mocks after each test to empty mocks, good ethic to always clean up before/after tests.
    vi.resetAllMocks();
    for (const limiter of Object.values(authLimiters)) {
        limiter.resetKey('::/56');
        limiter.resetKey('127.0.0.1');
        limiter.resetKey('::ffff:127.0.0.1');
    }
    
    // create the actual mock return values for the Model mock created above
    User.findOne.mockResolvedValue(null);
    User.findById.mockResolvedValue(null);
    RefreshSession.findOneAndDelete.mockResolvedValue(null);
    User.create.mockResolvedValue({_id: 'member123'});
    RefreshSession.create.mockResolvedValue({});
    RefreshSession.deleteOne.mockResolvedValue({ deletedCount: 1 });
});

// Returns the full Set-Cookie string for the cookie called `name`
const getCookie = (response, name) =>
    response.headers['set-cookie'].find(value => value.startsWith(`${name}=`));

// Returns just the value of a Set-Cookie string
const cookieValue = cookie => cookie.split(';')[0].slice(cookie.indexOf('=') + 1);
const originalNodeEnv = env.nodeEnv;
afterEach(() => {
    env.nodeEnv = originalNodeEnv;
});

function expectAccessCookie(cookie) {
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/;');
    expect(cookie).toContain('Max-Age=900');
}

function expectAccessCookieCleared(response) {
    const cookie = getCookie(response, 'accessToken');
    expect(cookie.split(';')[0]).toBe('accessToken=');
    expect(cookie).toContain('Path=/;');
}

const validMember = {
    username: 'martin123',
    name: 'Martin',
    email: 'martin@example.com',
    password: 'secret123'
};

const invalidMembers= [
    { ...validMember, email: 'invalidEmail'},
    {...validMember, password: 'sho'},
    {}, // Missing required fields
    { ...validMember, username: 'sho' },
    { ...validMember, name: '' },
    { ...validMember, password: 'x'.repeat(41) },
    { ...validMember, phoneNumber: 'invalid' }
]

/**
 * describe is a logical grouping of multiple tests together defined by 'it'. each it is its own test where you create a request to our app with the target
 * endpoint and and body and the check whether the outcome, status, error, output, number of function calls are as expected
 */

describe('POST /api/auth/register', () => {
    it('Returns 201 for valid registration', async() => {
        const response = await request(app)
            .post('/api/auth/register').set('Origin', 'http://localhost:3000')
            .send(validMember);
        
        expect(response.status).toBe(201);
        expect(User.create).toHaveBeenCalledOnce();

        const savedMember = User.create.mock.calls[0][0];
        expect(User.findOne).toHaveBeenCalledWith({
            $or: [{ username: validMember.username }, { 'profile.email': validMember.email }]
        });
        expect(savedMember.username).toBe(validMember.username);
        expect(savedMember.profile.name).toBe(validMember.name);
        expect(savedMember.profile.email).toBe(validMember.email);
        expect(
            await bcrypt.compare(validMember.password, savedMember.password)
        ).toBe(true);
    });

    it.each(['findOne', 'create'])(
    'returns 500 when registration %s fails',
    async (operation) => {
        User[operation].mockRejectedValue(
            new Error('Database unavailable')
        );

        const response = await request(app)
            .post('/api/auth/register').set('Origin', 'http://localhost:3000')
            .send(validMember);

        expect(response.status).toBe(500);

        if (operation === 'findOne') {
            expect(User.create).not.toHaveBeenCalled();
        }
    });

    it.each(invalidMembers)(
        'returns 400 for invalid input %#', 
        async (member) => {
        const response = await request(app)
            .post('/api/auth/register').set('Origin', 'http://localhost:3000')
            .send(member);

        expect(response.status).toBe(400);
        expect(User.findOne).not.toHaveBeenCalled();
        expect(User.create).not.toHaveBeenCalled();
    });

    it('returns 409 when a member already exists', async () => {
        User.findOne.mockResolvedValue({ username: 'martin123' });

        const response = await request(app)
            .post('/api/auth/register').set('Origin', 'http://localhost:3000')
            .send(validMember);

        expect(response.status).toBe(409);
        expect(User.create).not.toHaveBeenCalled();
    });

    it('returns 409 for a duplicate-key error during saving', async () => {
        User.create.mockRejectedValue({ code: 11000 });

        const response = await request(app)
            .post('/api/auth/register').set('Origin', 'http://localhost:3000')
            .send(validMember);

        expect(response.status).toBe(409);
    });
});

const invalidLogin = [
    null,
    {
        _id: 123,
        username: 'martythebest',
        profile: { name: 'Martin', email: 'martin@example.com' },
        password: await bcrypt.hash("mesh_malakshDa3wa?", 10)
    }
]

const incompleteLogin = [
    {},
    {username: "nonofurbeez"},
    {password: "mesh2elakda3wa"},
    { username: '', password: 'secret123' },
    { username: 'martin123', password: '' },
    { username: 123, password: 'secret123' },
    { username: 'martin123', password: 123 }
]

describe('POST /api/auth/login', () => {
    it('returns 500 without issuing tokens when session storage fails', async () => {
        User.findOne.mockResolvedValue({
            _id: 'member123',
            password: await bcrypt.hash('secret123', 10)
        });
        RefreshSession.create.mockRejectedValue(new Error('Session storage unavailable'));

        const response = await request(app).post('/api/auth/login').set('Origin', 'http://localhost:3000')
            .send({ username: 'martin123', password: 'secret123' });

        expect(response.status).toBe(500);
        expect(response.body).not.toHaveProperty('accessToken');
        expect(response.headers['set-cookie']).toBeUndefined();
    });

    it('Returns 200 for successful login', async () =>{
        User.findOne.mockResolvedValue({
                _id: 123,
                username: 'martythebest',
                role: 'member',
                profile: { name: 'Martin', email: 'martin@example.com' },
                password: await bcrypt.hash("malakshDa3wa?", 10)
                
        });

        const response = await request(app)
            .post('/api/auth/login').set('Origin', 'http://localhost:3000')
            .send({
                username: "martythebest",
                password: "malakshDa3wa?"
            });
        
        expect(User.findOne).toHaveBeenCalledWith({
                username: 'martythebest'
        });

        expect(response.status).toBe(200);
        // the access token is only sent as an httpOnly cookie, never in the body
        expect(response.body).not.toHaveProperty('accessToken');

        const accessCookie = getCookie(response, 'accessToken');
        expectAccessCookie(accessCookie);
        const payload = jwt.verify(cookieValue(accessCookie), env.jwtSecret);

        expect(response.body.user).toEqual({
            id: '123',
            username: 'martythebest',
            name: 'Martin',
            email: 'martin@example.com'
        });
        expect(payload.id).toBe('123');
        expect(payload.role).toBe('member');
        expect(payload.exp - payload.iat).toBe(15 * 60);

        const cookie = getCookie(response, 'refreshToken');
        expect(cookie).toContain('HttpOnly');
        expect(cookie).toContain('SameSite=Strict');
        expect(cookie).toContain('Path=/api/auth');
        expect(cookie).toContain('Max-Age=604800');

        const refreshToken = cookie.split(';')[0].slice('refreshToken='.length);
        expect(refreshToken).toMatch(/^[a-f0-9]{64}$/);
        expect(response.body).not.toHaveProperty('refreshToken');
        expect(RefreshSession.create).toHaveBeenCalledOnce();

        const session = RefreshSession.create.mock.calls[0][0];
        expect(session.userId).toBe(123);
        expect(session.tokenHash).toBe(crypto.createHash('sha256').update(refreshToken).digest('hex'));
        expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now() + 604790000);
        expect(session.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 604800000);
    });

    it('Returns 403 for suspended user login', async () => {
        User.findOne.mockResolvedValue({
            _id: 123,
            username: 'martythebest',
            name: 'Martin',
            email: 'martin@example.com',
            password: await bcrypt.hash("malakshDa3wa?", 10),
            suspended: true
        });

        const response = await request(app)
            .post('/api/auth/login')
            .send({
                username: "martythebest",
                password: "malakshDa3wa?"
            });

        expect(response.status).toBe(403);
        expect(response.body).toEqual({ message: "Your account has been suspended. Please contact support." });
        expect(RefreshSession.create).not.toHaveBeenCalled();
        expect(response.headers['set-cookie']).toBeUndefined();
        expect(response.body).not.toHaveProperty('accessToken');
    });

    it.each(invalidLogin)(
        'Returns 401 for unsuccessful login (username/password mismatch)',
        async (invalidLogin) =>{
        User.findOne.mockResolvedValue(invalidLogin);

        const response = await request(app)
            .post('/api/auth/login').set('Origin', 'http://localhost:3000')
            .send({
                username: "martythebest",
                password: "malakshDa3wa?"
            });
        
        expect(response.status).toBe(401);
        expect(RefreshSession.create).not.toHaveBeenCalled();
        expect(response.headers['set-cookie']).toBeUndefined();
        expect(response.body).not.toHaveProperty('accessToken');
        expect(response.body).not.toHaveProperty('user');
    });

    it.each(incompleteLogin)('Returns 400 for incomplete login data',
        async (incompleteLogin) =>{
        const response = await request(app)
            .post('/api/auth/login').set('Origin', 'http://localhost:3000')
            .send(incompleteLogin);
        
        expect(User.findOne).not.toHaveBeenCalled();
        expect(response.status).toBe(400);
        expect(RefreshSession.create).not.toHaveBeenCalled();
        expect(response.headers['set-cookie']).toBeUndefined();
        expect(response.body).not.toHaveProperty('accessToken');
        expect(response.body).not.toHaveProperty('user');
    });

    it('returns 500 when the login lookup fails', async () => {
    User.findOne.mockRejectedValue(new Error('Database unavailable'));

    const response = await request(app)
        .post('/api/auth/login').set('Origin', 'http://localhost:3000')
        .send({
            username: 'martythebest',
            password: 'secret123'
        });

    expect(response.status).toBe(500);
    expect(response.body).not.toHaveProperty('accessToken');
    });
});

describe('POST /api/auth/logout', () => {
    function expectClearedCookie(response) {
        const cookie = response.headers['set-cookie'].find(value => value.startsWith('refreshToken='));
        expect(cookie.split(';')[0]).toBe('refreshToken=');
        expect(cookie).toContain('Path=/api/auth');
        const expires = cookie.match(/Expires=([^;]+)/)[1];
        expect(new Date(expires).getTime()).toBeLessThan(Date.now());
        expectAccessCookieCleared(response);
    }

    it('deletes the matching session and clears the cookie', async () => {
        const refreshToken = 'test-refresh-token';
        const response = await request(app).post('/api/auth/logout').set('Origin', 'http://localhost:3000')
            .set('Cookie', `refreshToken=${refreshToken}`);

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ message: 'Logged out successfully' });
        expect(RefreshSession.deleteOne).toHaveBeenCalledExactlyOnceWith({
            tokenHash: crypto.createHash('sha256').update(refreshToken).digest('hex')
        });
        expectClearedCookie(response);
    });

    it('succeeds without a cookie and skips database deletion', async () => {
        const response = await request(app).post('/api/auth/logout').set('Origin', 'http://localhost:3000');

        expect(response.status).toBe(200);
        expect(RefreshSession.deleteOne).not.toHaveBeenCalled();
        expectClearedCookie(response);
    });

    it('returns 500 when session deletion fails', async () => {
        RefreshSession.deleteOne.mockRejectedValue(new Error('Database unavailable'));
        const response = await request(app).post('/api/auth/logout').set('Origin', 'http://localhost:3000')
            .set('Cookie', 'refreshToken=test-token');

        expect(response.status).toBe(500);
        expect(response.body).not.toHaveProperty('accessToken');
    });
});

describe('POST /api/auth/refresh', () => {
    const oldToken = 'old-refresh-token';
    const user = { _id: 'user123', username: 'martin123', role: 'lender' };
    const sendRefresh = () => request(app).post('/api/auth/refresh').set('Origin', 'http://localhost:3000')
        .set('Cookie', `refreshToken=${oldToken}`);

    it.each(['production', 'development'])('sets Secure only in production (%s)', async mode => {
        // The controller reads the configuration captured when env.js loads.
        env.nodeEnv = mode;
        RefreshSession.findOneAndDelete.mockResolvedValueOnce({ userId: user._id });
        User.findById.mockResolvedValue(user);
        const response = await sendRefresh();
        expect(response.status).toBe(200);
        for (const cookie of response.headers['set-cookie']) {
            expect(cookie.includes('; Secure')).toBe(mode === 'production');
        }
    });

    it('a concurrent rejected refresh cannot erase the winning response cookies', async () => {
        RefreshSession.findOneAndDelete.mockResolvedValueOnce({ userId: user._id });
        User.findById.mockResolvedValue(user);
        const responses = await Promise.all([sendRefresh(), sendRefresh()]);
        expect(responses.map(response => response.status).sort()).toEqual([200, 401]);
        expect(responses.find(response => response.status === 401).headers['set-cookie']).toBeUndefined();
        expect(responses.find(response => response.status === 200).headers['set-cookie']).toHaveLength(2);
        expect(RefreshSession.create).toHaveBeenCalledOnce();
    });

    function expectRejected(response) {
        expect(response.status).toBe(401);
        expect(response.body).not.toHaveProperty('accessToken');
        expect(RefreshSession.create).not.toHaveBeenCalled();
        expect(response.headers['set-cookie']).toBeUndefined();
    }

    it('rejects missing cookies without accessing the database', async () => {
        const response = await request(app).post('/api/auth/refresh').set('Origin', 'http://localhost:3000');
        expectRejected(response);
        expect(RefreshSession.findOneAndDelete).not.toHaveBeenCalled();
    });

    it('rejects unknown, expired, or already consumed tokens', async () => {
        expectRejected(await sendRefresh());
        expect(RefreshSession.findOneAndDelete).toHaveBeenCalledWith({
            tokenHash: crypto.createHash('sha256').update(oldToken).digest('hex'),
            expiresAt: { $gt: expect.any(Date) }
        });
        expect(User.findById).not.toHaveBeenCalled();
    });

    it('rejects sessions belonging to a deleted user', async () => {
        RefreshSession.findOneAndDelete.mockResolvedValue({ userId: user._id });
        expectRejected(await sendRefresh());
        expect(User.findById).toHaveBeenCalledWith(user._id);
    });

    it('rotates the refresh token and issues a 15-minute access token', async () => {
        RefreshSession.findOneAndDelete.mockResolvedValueOnce({ userId: user._id });
        User.findById.mockResolvedValue(user);
        const startedAt = Date.now();
        const response = await sendRefresh();
        const finishedAt = Date.now();

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ message: 'Token refreshed' });
        const accessCookie = getCookie(response, 'accessToken');
        expectAccessCookie(accessCookie);
        const payload = jwt.verify(cookieValue(accessCookie), env.jwtSecret);
        expect(payload.id).toBe(user._id);
        expect(payload.role).toBe(user.role);
        expect(payload.exp - payload.iat).toBe(900);
        const cookie = getCookie(response, 'refreshToken');
        const newToken = cookie.split(';')[0].slice('refreshToken='.length);
        expect(newToken).toMatch(/^[a-f0-9]{64}$/);
        expect(newToken).not.toBe(oldToken);
        expect(cookie).toContain('HttpOnly');
        expect(cookie).toContain('SameSite=Strict');
        expect(cookie).toContain('Path=/api/auth');
        expect(cookie).toContain('Max-Age=604800');
        expect(User.findById).toHaveBeenCalledWith(user._id);
        expect(RefreshSession.create).toHaveBeenCalledExactlyOnceWith({
            userId: user._id,
            tokenHash: crypto.createHash('sha256').update(newToken).digest('hex'),
            expiresAt: expect.any(Date)
        });
        const savedSession = RefreshSession.create.mock.calls[0][0];
        expect(savedSession.expiresAt.getTime()).toBeGreaterThanOrEqual(startedAt + 604800000);
        expect(savedSession.expiresAt.getTime()).toBeLessThanOrEqual(finishedAt + 604800000);
        const filter = RefreshSession.findOneAndDelete.mock.calls[0][0];
        expect(filter.expiresAt.$gt.getTime()).toBeGreaterThanOrEqual(startedAt);
        expect(filter.expiresAt.$gt.getTime()).toBeLessThanOrEqual(finishedAt);

        // The consumed token no longer has a matching session.
        const replay = await sendRefresh();
        expect(replay.status).toBe(401);
        expect(RefreshSession.create).toHaveBeenCalledOnce();
    });

    it('rejects suspended users', async () => {
        RefreshSession.findOneAndDelete.mockResolvedValueOnce({ userId: user._id });
        User.findById.mockResolvedValue({ ...user, suspended: true });

        const response = await request(app).post('/api/auth/refresh')
            .set('Cookie', `refreshToken=${oldToken}`);

        expect(response.status).toBe(403);
        expect(response.body).toEqual({ message: "Your account has been suspended. Please contact support." });
        expect(response.headers['set-cookie'][0]).toContain('refreshToken=;');
        expect(response.body).not.toHaveProperty('accessToken');
        expect(RefreshSession.create).not.toHaveBeenCalled();
    });

    it.each(['consume', 'lookup', 'save'])('returns 500 when %s fails', async (stage) => {
        RefreshSession.findOneAndDelete.mockResolvedValue({ userId: user._id });
        User.findById.mockResolvedValue(user);
        const error = new Error('Database unavailable');
        if (stage === 'consume') RefreshSession.findOneAndDelete.mockRejectedValue(error);
        if (stage === 'lookup') User.findById.mockRejectedValue(error);
        if (stage === 'save') RefreshSession.create.mockRejectedValue(error);

        const response = await sendRefresh();
        expect(response.status).toBe(500);
        expect(response.body).not.toHaveProperty('accessToken');
        expect(response.headers['set-cookie']).toBeUndefined();
    });
});
