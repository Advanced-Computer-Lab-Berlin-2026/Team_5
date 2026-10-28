
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateSuspension } from '../controllers/adminController.js';
import { User } from '../models/User.js';
import { RefreshSession } from '../models/RefreshSession.js';

vi.mock('../models/User.js', () => ({
    User: {
        findById: vi.fn()
    }
}));

vi.mock('../models/RefreshSession.js', () => ({
    RefreshSession: {
        deleteMany: vi.fn()
    }
}));

describe('updateSuspension', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        RefreshSession.deleteMany.mockResolvedValue({ deletedCount: 1 });
    });

    it('should return 400 if suspended is not a boolean', async () => {
        const req = {
            params: { id: 'ahmed123' },
            body: { suspended: "true" }
        };
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };

        await updateSuspension(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
            error: 'Suspension status must be a boolean.'
        });
        expect(User.findById).not.toHaveBeenCalled();
        expect(RefreshSession.deleteMany).not.toHaveBeenCalled();
    });

    it('should return 404 if user is not found', async () => {
        const req = {
            params: { id: 'unknownuser' },
            body: { suspended: true }
        };
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };

        User.findById.mockResolvedValue(null);

        await updateSuspension(req, res);

        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith({
            error: 'User not found.'
        });
        expect(User.findById).toHaveBeenCalledWith('unknownuser');
        expect(User.findById).toHaveBeenCalledTimes(1);
        expect(RefreshSession.deleteMany).not.toHaveBeenCalled();
    });

    it('should return 200 and suspend a member', async () => {
        const mockUser = {
            _id: 'ahmed123',
            username: 'ahmed123',
            role: 'member',
            suspended: false,
            save: vi.fn().mockResolvedValue(true)
        };

        const req = {
            params: { id: 'ahmed123' },
            body: { suspended: true }
        };
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };

        User.findById.mockResolvedValue(mockUser);

        await updateSuspension(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({
            message: 'User suspension status updated to true.'
        });
        expect(mockUser.suspended).toBe(true);
        expect(mockUser.save).toHaveBeenCalledTimes(1);
        expect(RefreshSession.deleteMany).toHaveBeenCalledWith({
            userId: mockUser._id
        });
        expect(RefreshSession.deleteMany).toHaveBeenCalledTimes(1);
    });

    it('should return 200 when reinstating a lender', async () => {
        const mockUser = {
            _id: 'lender123',
            username: 'lender123',
            role: 'lender',
            suspended: true,
            save: vi.fn().mockResolvedValue(true)
        };

        const req = {
            params: { id: 'lender123' },
            body: { suspended: false }
        };
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };

        User.findById.mockResolvedValue(mockUser);

        await updateSuspension(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({
            message: 'User suspension status updated to false.'
        });
        expect(mockUser.suspended).toBe(false);
        expect(mockUser.save).toHaveBeenCalledTimes(1);
        expect(RefreshSession.deleteMany).not.toHaveBeenCalled();
    });

    it('should return 403 if trying to suspend an admin', async () => {
        const mockUser = {
            _id: 'admin123',
            username: 'admin123',
            role: 'admin',
            suspended: false,
            save: vi.fn().mockResolvedValue(true)
        };

        const req = {
            params: { id: 'admin123' },
            body: { suspended: true }
        };
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };

        User.findById.mockResolvedValue(mockUser);

        await updateSuspension(req, res);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({
            error: 'You can only suspend members or lenders.'
        });
        expect(mockUser.save).not.toHaveBeenCalled();
        expect(mockUser.suspended).toBe(false);
        expect(RefreshSession.deleteMany).not.toHaveBeenCalled();
    });

    it('should return 500 if the user lookup fails', async () => {
        const req = {
            params: { id: 'ahmed456' },
            body: { suspended: true }
        };
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };

        User.findById.mockRejectedValue(new Error('Database error'));

        await updateSuspension(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({
            error: 'An error occurred while updating suspension status.'
        });
        expect(User.findById).toHaveBeenCalledWith('ahmed456');
        expect(User.findById).toHaveBeenCalledTimes(1);
        expect(RefreshSession.deleteMany).not.toHaveBeenCalled();
    });

    it('should handle database save failure gracefully', async () => {
        const mockUser = {
            _id: 'ahmed789',
            username: 'ahmed789',
            role: 'member',
            suspended: false,
            save: vi.fn().mockRejectedValue(
                new Error('Database save error')
            )
        };

        const req = {
            params: { id: 'ahmed789' },
            body: { suspended: true }
        };
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };

        User.findById.mockResolvedValue(mockUser);

        await updateSuspension(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({
            error: 'An error occurred while updating suspension status.'
        });
        expect(mockUser.save).toHaveBeenCalledTimes(1);
        expect(RefreshSession.deleteMany).not.toHaveBeenCalled();
    });

    it('should return 500 if refresh session deletion fails', async () => {
        const mockUser = {
            _id: 'member456',
            username: 'member456',
            role: 'member',
            suspended: false,
            save: vi.fn().mockResolvedValue(true)
        };

        const req = {
            params: { id: 'member456' },
            body: { suspended: true }
        };
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };

        User.findById.mockResolvedValue(mockUser);
        RefreshSession.deleteMany.mockRejectedValue(
            new Error('Session deletion failed')
        );

        await updateSuspension(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({
            error: 'An error occurred while updating suspension status.'
        });
        expect(mockUser.save).toHaveBeenCalledTimes(1);
        expect(RefreshSession.deleteMany).toHaveBeenCalledWith({
            userId: 'member456'
        });
    });
});
