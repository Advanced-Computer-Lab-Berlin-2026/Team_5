import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateCategoryDepositMultiplier } from '../controllers/adminController.js';
import { Category } from '../models/Category.js';

vi.mock('../models/Category.js', () => ({
    Category: {
        findById: vi.fn()
    }
}));

describe('updateCategoryDepositMultiplier', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('rejects invalid multipliers before looking up the category', async () => {
        const req = {
            params: { id: 'Power Tools' },
            body: { depositMultiplier: 0.5 }
        };
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };

        await updateCategoryDepositMultiplier(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
            error: 'Deposit multiplier must be a finite number greater than or equal to 1.'
        });
        expect(Category.findById).not.toHaveBeenCalled();
    });

    it('returns 404 when the category does not exist', async () => {
        Category.findById.mockResolvedValue(null);
        const req = {
            params: { id: 'Power Tools' },
            body: { depositMultiplier: 2 }
        };
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };

        await updateCategoryDepositMultiplier(req, res);

        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith({ error: 'Category not found.' });
        expect(Category.findById).toHaveBeenCalledWith('Power Tools');
    });

    it('updates and returns the category multiplier', async () => {
        const category = {
            _id: 'Power Tools',
            name: 'Power Tools',
            depositMultiplier: 1,
            save: vi.fn().mockResolvedValue(true)
        };
        Category.findById.mockResolvedValue(category);
        const req = {
            params: { id: 'Power Tools' },
            body: { depositMultiplier: 2.5 }
        };
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };

        await updateCategoryDepositMultiplier(req, res);

        expect(category.depositMultiplier).toBe(2.5);
        expect(category.save).toHaveBeenCalledTimes(1);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({ category });
    });
});
