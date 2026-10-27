
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { viewUserDetails } from '../controllers/adminController.js';
import { User } from '../models/User.js';

vi.mock('../models/User.js', () => ({
    User: {
        findById: vi.fn()
    }
}));

describe('viewUserDetails', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('should return 404 if user is not found', async () => {
        const req = {
            params: { id: 'ahmed123' }
        };
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };

        User.findById.mockReturnValue({
            select: vi.fn().mockResolvedValue(null)
        });

        await viewUserDetails(req, res);

        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith({
            error: 'User not found.'
        });
        expect(User.findById).toHaveBeenCalledWith('ahmed123');
    });

    it('should return 403 if user role is not member or lender', async () => {
        const req = {
            params: { id: 'admin123' }
        };
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };

        User.findById.mockReturnValue({
            select: vi.fn().mockResolvedValue({
                _id: 'admin123',
                username: 'admin123',
                role: 'admin'
            })
        });

        await viewUserDetails(req, res);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({
            error: 'You can only view details of members or lenders.'
        });
    });

    it('should return 200 and basic user details for a member', async () => {
        const req = {
            params: { id: 'ahmed123' }
        };
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };

        const mockUser = {
            _id: 'ahmed123',
            username: 'ahmed123',
            role: 'member',
            profile: {
                name: 'Ahmed',
                email: 'ahmed@example.com',
                phone: '123456789',
                address: 'Berlin'
            }
        };

        const mockSelect = vi.fn().mockResolvedValue(mockUser);

        User.findById.mockReturnValue({
            select: mockSelect
        });

        await viewUserDetails(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({
            user: mockUser
        });
        expect(User.findById).toHaveBeenCalledWith('ahmed123');

        expect(mockSelect).toHaveBeenCalledWith(
            'username role profile.name profile.email profile.phone profile.address'
        );

        expect(res.json.mock.calls[0][0].user).not.toHaveProperty('password');
    });

    it('should return 200 and basic user details for a lender', async () => {
        const req = {
            params: { id: 'lender123' }
        };
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };

        const mockUser = {
            _id: 'lender123',
            username: 'lender123',
            role: 'lender',
            profile: {
                name: 'Lender',
                email: 'lender@example.com',
                phone: '987654321',
                address: 'Berlin'
            }
        };

        User.findById.mockReturnValue({
            select: vi.fn().mockResolvedValue(mockUser)
        });

        await viewUserDetails(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({
            user: mockUser
        });
    });

    it('should return 500 if there is an unexpected error', async () => {
        const req = {
            params: { id: 'ahmed456' }
        };
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };

        User.findById.mockReturnValue({
            select: vi.fn().mockRejectedValue(
                new Error('Database error')
            )
        });

        await viewUserDetails(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({
            error: 'An error occurred while viewing user details.'
        });
        expect(User.findById).toHaveBeenCalledWith('ahmed456');
        expect(User.findById).toHaveBeenCalledTimes(1);
    });
});
