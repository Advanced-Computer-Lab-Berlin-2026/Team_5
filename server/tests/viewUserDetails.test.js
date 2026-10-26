import {describe, it, expect, vi, beforeEach} from 'vitest';
import {viewUserDetails} from '../controllers/adminController.js';
import { User } from '../models/User.js';


vi.mock('../models/User.js', () => {
    return {
        User: {
            findById: vi.fn()
        }
    }
});

describe('viewUserDetails', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    })

    it('should return 400 if userId is not a valid ObjectId', async () => {
        const req = {
            params: { id: 'invalid-id' }
        };
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };
        await viewUserDetails(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: 'Invalid user ID.' });
        expect(User.findById).not.toHaveBeenCalled();
    });


    it('should return 404 if user is not found', async () => {
        const req = {
            params: { id: '507f1f77bcf86cd799439011' }
        };
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };
        User.findById.mockReturnValue({select: vi.fn().mockResolvedValue(null)});
        await viewUserDetails(req, res);
        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith({ error: 'User not found.' });
    });

    it('should return 403 if user role is not member or lender', async () => {
        const req = {
            params: { id: '507f1f77bcf86cd799439011' }
        };
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };
        User.findById.mockReturnValue({select: vi.fn().mockResolvedValue({ role: 'admin' })});
        await viewUserDetails(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ error: 'You can only view details of members or lenders.' });
    });

    it('should return 200 and user details if user is found and role is member or lender', async () => {
        const req = {
            params: { id: '507f1f77bcf86cd799439011' }
        };
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };
        const mockUser = { _id: '507f1f77bcf86cd799439011', role: 'member', name: 'Ahmed' };
        const mockSelect = vi.fn().mockResolvedValue(mockUser);
        User.findById.mockReturnValue({select: mockSelect});
        await viewUserDetails(req, res);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({ user: mockUser });
        expect(User.findById).toHaveBeenCalledWith('507f1f77bcf86cd799439011');
        expect(res.json.mock.calls[0][0].user).not.toHaveProperty('password');
        expect(mockSelect).toHaveBeenCalledWith('-password -__v');
    });

    it('should return 500 if there is an unexpected error', async () => {
        const req = {
            params: { id: '507f1f77bcf86cd799439014' },
        };
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };
        User.findById.mockReturnValue({
            select: vi.fn().mockRejectedValue(new Error('Database error'))
        });
        await viewUserDetails(req, res);
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({ error: 'An error occurred while viewing user details.' });
        expect(User.findById).toHaveBeenCalledWith('507f1f77bcf86cd799439014');
        expect(User.findById).toHaveBeenCalledTimes(1);
    });
});