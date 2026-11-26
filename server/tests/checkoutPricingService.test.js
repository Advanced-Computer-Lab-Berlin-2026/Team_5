import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    validatePromoCode: vi.fn(),
    recordPromoRedemption: vi.fn()
}));

vi.mock('../services/promoCodeService.js', () => ({
    validatePromoCode: mocks.validatePromoCode,
    recordPromoRedemption: mocks.recordPromoRedemption
}));

import {
    calculateCheckoutPricing,
    normalizePromoCode
} from '../services/checkoutPricingService.js';

const items = [
    { itemId: 'CAMERA', depositAmount: 100 },
    { itemId: 'SPEAKER', depositAmount: 50 }
];

beforeEach(() => {
    vi.resetAllMocks();
    mocks.validatePromoCode.mockResolvedValue({ valid: true, discountPercent: 20 });
});

describe('checkout promo pricing', () => {
    it('does not validate or change amounts when there is no promo', async () => {
        const result = await calculateCheckoutPricing('member1', items);
        expect(result.totalDeposit).toBe(150);
        expect(result.items.map(item => item.depositAmount)).toEqual([100, 50]);
        expect(result.promoCode).toBeNull();
        expect(mocks.validatePromoCode).not.toHaveBeenCalled();
    });

    it('applies one 20% discount across all checkout items', async () => {
        const result = await calculateCheckoutPricing('member1', items, ' save20 ');
        expect(mocks.validatePromoCode).toHaveBeenCalledWith('SAVE20', 'member1', 50, null);
        expect(result).toMatchObject({
            originalTotal: 150,
            totalDeposit: 120,
            totalCents: 12000,
            discountPercent: 20,
            promoCode: 'SAVE20'
        });
        expect(result.items.map(item => item.depositAmount)).toEqual([80, 40]);
    });

    it('sums independently rounded item quotes', async () => {
        mocks.validatePromoCode.mockResolvedValueOnce({ valid: true, discountPercent: 10 });

        const result = await calculateCheckoutPricing('member1', [
            { depositAmount: 10.05 },
            { depositAmount: 20.05 }
        ], 'SAVE10');

        expect(result.items.map(item => item.depositAmount)).toEqual([9.04, 18.04]);
        expect(result.totalDeposit).toBe(27.08);
        expect(result.totalCents).toBe(2708);
        expect(result.lowestItemDeposit).toBe(10.05);
    });

    it('rejects invalid promo codes and validation responses', async () => {
        mocks.validatePromoCode.mockResolvedValueOnce({ valid: false });
        await expect(calculateCheckoutPricing('member1', items, 'BAD'))
            .rejects.toMatchObject({ code: 'INVALID_PROMO_CODE' });

        mocks.validatePromoCode.mockResolvedValueOnce({ valid: true, discountPercent: 150 });
        await expect(calculateCheckoutPricing('member1', items, 'SAVE20'))
            .rejects.toThrow('Invalid discount percentage');
    });

    it('rejects whitespace promo codes and negative deposits', async () => {
        expect(() => normalizePromoCode('   ')).toThrow();
        await expect(calculateCheckoutPricing('member1', [{ depositAmount: -1 }]))
            .rejects.toThrow('Invalid deposit amount');
    });
});
