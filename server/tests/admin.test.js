import {describe, it, expect, vi, beforeEach} from 'vitest';
import {updateSuspension} from '../controllers/adminController.js';
import User from '../models/User.js';

vi.mock('../models/User.js', () => {
    return {
        default: {
            findById: vi.fn()
        }
    }
});

describe('updateSuspension', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('should return 400 if suspended is not a boolean', async () => {
        const req = {
            params: { id: '507f1f77bcf86cd799439011' },
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



    it('should return 400 if userId is not a valid ObjectId', async () => {
        const req = {
            params: { id: 'invalid-id' },
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
            params: { id: '507f1f77bcf86cd799439011' },
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
        expect(User.findById).toHaveBeenCalledWith('507f1f77bcf86cd799439011');
        expect(User.findById).toHaveBeenCalledTimes(1);
    });


    it('should return 200 and update suspension status for valid member or lender', async () => {
        const mockUser = {
            _id: '507f1f77bcf86cd799439011',
            role: 'member',
            suspended: false,
            save: vi.fn().mockResolvedValue(true)
        };
        const req = {
            params: { id: '507f1f77bcf86cd799439011' },
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
    });

    it('should return 200 for successful suspension update with false for a lender', async () => {
        const mockUser = {
            _id: '507f1f77bcf86cd799439012',
            role: 'lender',
            suspended: true,
            save: vi.fn().mockResolvedValue(true)
        };  
        const req = {
            params: { id: '507f1f77bcf86cd799439012' },
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
    });

    it('should return 403 if trying to suspend an admin', async () => {
        const mockUser = {
            _id: '507f1f77bcf86cd799439013',
            role: 'admin',
            suspended: false,
            save: vi.fn().mockResolvedValue(true)
        };
        const req = {
            params: { id: '507f1f77bcf86cd799439013' },
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
            params: { id: '507f1f77bcf86cd799439014' },
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
        expect(User.findById).toHaveBeenCalledWith('507f1f77bcf86cd799439014');
        expect(User.findById).toHaveBeenCalledTimes(1);
    });
    it('should handle database save failure gracefully', async () => {   
        const mockUser = {
            _id: '507f1f77bcf86cd799439015',
            role: 'member',
            suspended: false,
            save: vi.fn().mockRejectedValue(new Error('Database save error'))
        };  
        const req = {
            params: { id: '507f1f77bcf86cd799439015' },
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