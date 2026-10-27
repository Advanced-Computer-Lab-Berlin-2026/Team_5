import {describe, it, expect, vi, beforeEach} from 'vitest';
import {updateSuspension} from '../controllers/adminController.js';
import { User } from '../models/User.js';
import { RefreshSession } from '../models/RefreshSession.js';

vi.mock('../models/User.js', () => {
    return {
        User: {
            findById: vi.fn()
        }
    }
});

vi.mock('../models/RefreshSession.js', () => ({
    RefreshSession: {
        deleteMany: vi.fn()
    }
}));

describe('updateSuspension', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('should return 400 if suspended is not a boolean', async () => {
        const req = {
            params: { id: 'member123' },
            body: { suspended: "true" }
        };
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };

        await updateSuspension(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: 'Suspension status must be a boolean.' });
        expect(User.findById).not.toHaveBeenCalled();
    });



    it.each([undefined, '', '   ', 123, {}])('returns 400 for an invalid username ID %j', async (id) => {
        const req = {
            params: { id },
            body: { suspended: true }
        };
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };
        await updateSuspension(req, res); 
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: 'Invalid user ID.' });
        expect(User.findById).not.toHaveBeenCalled(); 

    });

    it('should return 404 if user is not found', async () => {
        const req = {
            params: { id: 'member123' },
            body: { suspended: true }
        };
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };
        User.findById.mockResolvedValue(null); // Simulate user not found
        await updateSuspension(req, res);
        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith({ error: 'User not found.' });
        expect(User.findById).toHaveBeenCalledWith('member123');
        expect(User.findById).toHaveBeenCalledTimes(1);
    });


    it('should return 200 and update suspension status for valid member or lender', async () => {
        const mockUser = {
            _id: 'member123',
            role: 'member',
            suspended: false,
            save: vi.fn().mockResolvedValue(true)
        };
        const req = {
            params: { id: 'member123' },
            body: { suspended: true }
        };  
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };
        User.findById.mockResolvedValue(mockUser);
        await updateSuspension(req, res);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({ message: 'User suspension status updated to true.' });
        expect(mockUser.suspended).toBe(true);
        expect(mockUser.save).toHaveBeenCalledTimes(1);
        expect(RefreshSession.deleteMany).toHaveBeenCalledWith({
            userId: mockUser._id
        });
    });

    it('should return 200 for successful suspension update with false for a lender', async () => {
        const mockUser = {
            _id: 'lender123',
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
        expect(res.json).toHaveBeenCalledWith({ message: 'User suspension status updated to false.' });
        expect(mockUser.suspended).toBe(false);
        expect(mockUser.save).toHaveBeenCalledTimes(1);
        expect(RefreshSession.deleteMany).not.toHaveBeenCalled();
    });

    it('should return 403 if trying to suspend an admin', async () => {
        const mockUser = {
            _id: 'admin123',
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
        expect(res.json).toHaveBeenCalledWith({ error: 'You can only suspend members or lenders.' });
        expect(mockUser.save).not.toHaveBeenCalled();
        expect(mockUser.suspended).toBe(false); // Ensure the suspended status remains unchanged
    });
    it('should return 500 if there is an unexpected error', async () => {
        const req = {
            params: { id: 'missinguser' },
            body: { suspended: true }
        };
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };
        User.findById.mockRejectedValue(new Error('Database error'));
        await updateSuspension(req, res);
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({ error: 'An error occurred while updating suspension status.' });
        expect(User.findById).toHaveBeenCalledWith('missinguser');
        expect(User.findById).toHaveBeenCalledTimes(1);
    });
    it('should handle database save failure gracefully', async () => {   
        const mockUser = {
            _id: 'member456',
            role: 'member',
            suspended: false,
            save: vi.fn().mockRejectedValue(new Error('Database save error'))
        };  
        const req = {
            params: { id: 'member456' },
            body: { suspended: true }   
        }
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };
        User.findById.mockResolvedValue(mockUser);
        await updateSuspension(req, res);
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({ error: 'An error occurred while updating suspension status.' });
        expect(mockUser.save).toHaveBeenCalledTimes(1);
    });
})