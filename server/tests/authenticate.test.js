import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import authenticate from '../middleware/authenticate.js';

vi.mock('../models/User.js', () => ({
    User: {
        findById: vi.fn()
    }
}));

describe('authenticate middleware', () => {

    const userId = '507f1f77bcf86cd799439011';

    beforeEach(() => {
        vi.resetAllMocks();
    });

    // Helper function to avoid repeating response mocks
    function createResponse() {
        return {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };
    }

    // Test 1: Missing Authorization header
    it('should reject requests without an Authorization header', async () => {
        const req = { headers: {} };
        const res = createResponse();
        const next = vi.fn();

        await authenticate(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({
            error: 'Authorization header missing or malformed.'
        });
        expect(next).not.toHaveBeenCalled();
    });

    // Test 2: Incorrect authorization scheme
    it('should reject requests with an incorrect authorization scheme', async () => {
        const req = {
            headers: { authorization: 'Basic abc123' }
        };
        const res = createResponse();
        const next = vi.fn();

        await authenticate(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });

    // Test 3: Empty Bearer token
    it('should reject an empty Bearer token', async () => {
        const req = {
            headers: { authorization: 'Bearer ' }
        };
        const res = createResponse();
        const next = vi.fn();

        await authenticate(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({
            error: 'Token missing.'
        });
        expect(next).not.toHaveBeenCalled();
    });

    // Test 4: Invalid JWT
    it('should reject an invalid JWT', async () => {
        const req = {
            headers: { authorization: 'Bearer invalid-token' }
        };
        const res = createResponse();
        const next = vi.fn();

        await authenticate(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({
            error: 'Invalid or expired token.'
        });
        expect(User.findById).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    // Test 5: Expired JWT
    it('should reject an expired JWT', async () => {
        const token = jwt.sign(
            { id: userId, username: 'testadmin' },
            env.jwtSecret,
            { expiresIn: -1 }
        );

        const req = {
            headers: { authorization: `Bearer ${token}` }
        };
        const res = createResponse();
        const next = vi.fn();

        await authenticate(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(User.findById).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    // Test 6: Successful authentication
    it('should authenticate a user with a valid JWT', async () => {
        const mockUser = {
            _id: userId,
            username: 'testadmin',
            role: 'member',
            suspended: false
        };

        const token = jwt.sign(
            { id: userId, username: 'testadmin' },
            env.jwtSecret,
            { expiresIn: '15m' }
        );

        User.findById.mockResolvedValue(mockUser);

        const req = {
            headers: { authorization: `Bearer ${token}` }
        };
        const res = createResponse();
        const next = vi.fn();

        await authenticate(req, res, next);

        expect(User.findById).toHaveBeenCalledWith(userId);
        expect(req.user).toBe(mockUser);
        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
        expect(res.json).not.toHaveBeenCalled();
    });

    it('should return 403 if the user is suspended', async () => {
        const mockUser = {
            _id: userId,
            username: 'testadmin',
            role: 'member',
            suspended: true
        };

        const token = jwt.sign(
            { id: userId, username: 'testadmin' },
            env.jwtSecret,
            { expiresIn: '15m' }
        );

        User.findById.mockResolvedValue(mockUser);

        const req = {
            headers: { authorization: `Bearer ${token}` }
        };
        const res = createResponse();
        const next = vi.fn();

        await authenticate(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({
            error: 'Your account has been suspended. Please contact support.'
        });
        expect(next).not.toHaveBeenCalled();
    });

    // Test 7: User no longer exists
    it('should return 401 if the token user does not exist', async () => {
        const token = jwt.sign(
            { id: userId, username: 'testadmin' },
            env.jwtSecret,
            { expiresIn: '15m' }
        );

        User.findById.mockResolvedValue(null);

        const req = {
            headers: { authorization: `Bearer ${token}` }
        };
        const res = createResponse();
        const next = vi.fn();

        await authenticate(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({
            error: 'User not found.'
        });
        expect(next).not.toHaveBeenCalled();
    });

    // Test 8: Database lookup fails
    it('should return 500 when the database lookup fails', async () => {
        const token = jwt.sign(
            { id: userId, username: 'testadmin' },
            env.jwtSecret,
            { expiresIn: '15m' }
        );

        User.findById.mockRejectedValue(new Error('Database unavailable'));

        const req = {
            headers: { authorization: `Bearer ${token}` }
        };
        const res = createResponse();
        const next = vi.fn();

        await authenticate(req, res, next);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({
            error: 'Internal server error.'
        });
        expect(next).not.toHaveBeenCalled();
    });

});