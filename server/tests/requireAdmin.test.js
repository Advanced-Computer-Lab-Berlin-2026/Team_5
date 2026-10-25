// Imports
import requireAdmin from '../middleware/requireAdmin.js';
import { describe, it, expect, vi } from 'vitest';
describe('requireAdmin middleware', () => {

    it('should reject unauthenticated users', () => {
        const req = {
            user: undefined
        };
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };
        const next = vi.fn();

        // Act: Call the function being tested
        requireAdmin(req, res, next);
        // Assert: Verify the expected behavior
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'You must be logged in to perform this action.' });
        expect(next).not.toHaveBeenCalled();
    });

    it('should reject non-admin users', () => {
        const req = {
            user: { role: 'member' }
        };
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };
        const next = vi.fn();
        // Act: Call the function being tested
        requireAdmin(req, res, next);
        // Assert: Verify the expected behavior
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ error: 'You do not have permission to perform this action.' });
        expect(next).not.toHaveBeenCalled();
    });

    it('should allow admin users to proceed', () => {
        const req = {
            user: { role: 'admin' }
        };
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };
        const next = vi.fn();   
        // Act: Call the function being tested
        requireAdmin(req, res, next);
        // Assert: Verify the expected behavior
        expect(res.status).not.toHaveBeenCalled();
        expect(res.json).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledTimes(1);
    });
});