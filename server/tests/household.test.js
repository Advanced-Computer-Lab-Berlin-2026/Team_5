import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import app from "../app.js";
import { User } from "../models/User.js";
import { FriendLink } from "../models/FriendLink.js";
import { requireAuth } from "../middleware/auth.js";

vi.mock('../models/User.js', () => ({
    User: { findOne: vi.fn(), findById: vi.fn() }
}));

vi.mock('../models/FriendLink.js', () => ({
    FriendLink: { exists: vi.fn(), create: vi.fn() }
}));

// replace only requireAuth, keep the other exports of the file
vi.mock('../middleware/auth.js', async (importOriginal) => ({
    ...(await importOriginal()),
    requireAuth: vi.fn()
}));

const TRUSTED_ORIGIN = 'http://localhost:3000';

const sender = { _id: 'member123', username: 'member123', profile: { name: 'Sara', address: '12 Main St' } };
const otherMember = {
    _id: 'member456',
    username: 'member456',
    profile: { name: 'Omar', email: 'omar@mail.com', phone: '0100', address: ' 12 main st ' }
};

// the query findOtherMember must send: anyone with that email/phone except the logged-in user
const otherMemberQuery = (value) => ({
    _id: { $ne: 'member123' },
    $or: [{ 'profile.email': value }, { 'profile.phone': value }],
});

beforeEach(() => {
    vi.resetAllMocks();

    // default happy baseline
    requireAuth.mockImplementation((req, res, next) => {
        req.user = { id: 'member123', role: 'member' };
        next();
    });
    User.findOne.mockResolvedValue(otherMember);
    User.findById.mockResolvedValue(sender);
    FriendLink.exists.mockResolvedValue(null);
    FriendLink.create.mockImplementation(async (data) => ({ _id: 'LNK-1', status: 'pending', ...data }));
});

describe('GET /api/household/search', () => {
    const sendSearch = (query) => request(app).get('/api/household/search').query(query);

    it('returns 200 with only the username and name', async () => {
        const response = await sendSearch({ query: 'omar@mail.com' });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ member: { username: 'member456', name: 'Omar' } });
        expect(User.findOne).toHaveBeenCalledExactlyOnceWith(otherMemberQuery('omar@mail.com'));
    });

    it('returns 400 when the query is missing or empty', async () => {
        for (const query of [{}, { query: '   ' }]) {
            const response = await sendSearch(query);
            expect(response.status).toBe(400);
        }
        expect(User.findOne).not.toHaveBeenCalled();
    });

    it('returns 404 when searching for your own email (you are excluded)', async () => {
        User.findOne.mockResolvedValue(null);

        const response = await sendSearch({ query: 'sara@mail.com' });

        expect(response.status).toBe(404);
        expect(response.body).toEqual({ message: 'No member found' });
        expect(User.findOne).toHaveBeenCalledExactlyOnceWith(otherMemberQuery('sara@mail.com'));
    });
});

describe('POST /api/household/requests', () => {
    const sendRequest = (body) =>
        request(app).post('/api/household/requests').set('Origin', TRUSTED_ORIGIN).send(body);

    it('returns 201 and creates a pending request', async () => {
        const response = await sendRequest({ emailOrPhone: '0100', relation: 'siblings' });

        expect(response.status).toBe(201);
        expect(response.body.message).toBe('Household request sent');
        expect(response.body.request.status).toBe('pending');
        expect(FriendLink.create).toHaveBeenCalledExactlyOnceWith({
            requester: 'member123', recipient: 'member456', relation: 'siblings'
        });
    });

    it('returns 400 for a relation that is not allowed', async () => {
        const response = await sendRequest({ emailOrPhone: '0100', relation: 'cousin' });

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ message: 'Invalid relation' });
        expect(FriendLink.create).not.toHaveBeenCalled();
    });

    it('returns 400 when emailOrPhone is missing', async () => {
        const response = await sendRequest({ relation: 'spouse' });

        expect(response.status).toBe(400);
        expect(FriendLink.create).not.toHaveBeenCalled();
    });

    it('returns 404 when no other member matches (including your own email)', async () => {
        User.findOne.mockResolvedValue(null);

        const response = await sendRequest({ emailOrPhone: 'sara@mail.com', relation: 'spouse' });

        expect(response.status).toBe(404);
        expect(FriendLink.create).not.toHaveBeenCalled();
    });

    it('returns 400 when the addresses are different', async () => {
        User.findOne.mockResolvedValue({ ...otherMember, profile: { ...otherMember.profile, address: '99 Other Rd' } });

        const response = await sendRequest({ emailOrPhone: '0100', relation: 'parent' });

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ message: 'You must live at the same address' });
        expect(FriendLink.create).not.toHaveBeenCalled();
    });

    it('returns 409 when a link already exists in either direction', async () => {
        FriendLink.exists.mockResolvedValue({ _id: 'LNK-1' });

        const response = await sendRequest({ emailOrPhone: '0100', relation: 'child' });

        expect(response.status).toBe(409);
        expect(FriendLink.exists).toHaveBeenCalledExactlyOnceWith({
            $or: [
                { requester: 'member123', recipient: 'member456' },
                { requester: 'member456', recipient: 'member123' },
            ],
        });
        expect(FriendLink.create).not.toHaveBeenCalled();
    });

    it('returns 401 when not logged in', async () => {
        requireAuth.mockImplementation((req, res) => res.status(401).json({ message: 'Authentication required' }));

        const response = await sendRequest({ emailOrPhone: '0100', relation: 'spouse' });

        expect(response.status).toBe(401);
        expect(FriendLink.create).not.toHaveBeenCalled();
    });
});