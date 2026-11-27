import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { PromoCode } from '../models/PromoCode.js';
import { PromoCodeUsage } from '../models/PromoCodeUsage.js';
import { calculateCheckoutPricing } from '../services/checkoutPricingService.js';
import { recordPromoRedemption, validatePromoCode } from '../services/promoCodeService.js';

const promo = {
    _id: 'SAVE10', code: 'SAVE10', active: true,
    discountPercent: 10, minimumDeposit: 10, maxUses: 2
};
const session = { inTransaction: () => true };
const checkoutId = new mongoose.Types.ObjectId();
const pricing = {
    originalTotal: 30.10, totalDeposit: 27.08, discountPercent: 10, lowestItemDeposit: 10.05
};
const walletRedemption = {
    promoCode: 'SAVE10', userId: 'member1', checkoutId,
    paymentIds: ['PAY-1', 'PAY-2'], reservationIds: ['RES-1', 'RES-2'],
    pricing, session
};

let lookupResult;
let lockedResult;
let usageCount;
let existingUsage;
let findPromo;
let lockPromo;
let countUses;
let findUsage;
let insertUsage;

beforeEach(() => {
    lookupResult = vi.fn().mockResolvedValue(promo);
    lockedResult = vi.fn().mockResolvedValue(promo);
    usageCount = vi.fn().mockResolvedValue(0);
    existingUsage = vi.fn().mockResolvedValue(null);

    findPromo = vi.spyOn(PromoCode, 'findOne').mockReturnValue({
        session: () => ({ lean: lookupResult })
    });
    lockPromo = vi.spyOn(PromoCode, 'findOneAndUpdate').mockReturnValue({ lean: lockedResult });
    countUses = vi.spyOn(PromoCodeUsage, 'countDocuments').mockReturnValue({ session: usageCount });
    findUsage = vi.spyOn(PromoCodeUsage, 'exists').mockReturnValue({ session: existingUsage });
    insertUsage = vi.spyOn(PromoCodeUsage, 'create').mockImplementation(async ([usage]) => {
        const doc = new PromoCodeUsage(usage);
        await doc.validate();
        return [doc];
    });
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('checkout promo validation', () => {
    it('normalizes the code and counts global uses by promo ID', async () => {
        await expect(validatePromoCode(' save10 ', 'member1', 10, session)).resolves.toEqual({
            valid: true, code: 'SAVE10', discountPercent: 10
        });
        expect(findPromo).toHaveBeenCalledWith({ code: 'SAVE10' });
        expect(countUses).toHaveBeenCalledWith({ code: 'SAVE10' });
        expect(usageCount).toHaveBeenCalledWith(session);
    });

    it.each([
        ['missing', null],
        ['inactive', { ...promo, active: false }],
        ['expired', { ...promo, expiresAt: new Date(0) }],
        ['invalid percentage', { ...promo, discountPercent: 0 }]
    ])('rejects a %s code', async (_label, record) => {
        lookupResult.mockResolvedValueOnce(record);
        await expect(validatePromoCode('SAVE10', 'member1', 10)).resolves.toEqual({ valid: false });
        expect(insertUsage).not.toHaveBeenCalled();
    });

    it('requires each discounted item to meet the minimum even when the cart total does', async () => {
        const cart = [{ depositAmount: 100 }, { depositAmount: 9.99 }];
        await expect(calculateCheckoutPricing('member1', cart, 'SAVE10')).rejects.toMatchObject({
            code: 'INVALID_PROMO_CODE'
        });
        expect(insertUsage).not.toHaveBeenCalled();
    });

    it('rejects an exhausted code at quote time', async () => {
        usageCount.mockResolvedValueOnce(promo.maxUses);
        await expect(validatePromoCode('SAVE10', 'member1', 10)).resolves.toEqual({ valid: false });
    });
});

describe('checkout promo redemption', () => {
    it('writes one wallet usage with total amounts and all references in the session', async () => {
        await recordPromoRedemption(walletRedemption);

        expect(lockPromo).toHaveBeenCalledWith(
            { code: 'SAVE10' },
            { $inc: { __v: 1 } },
            { returnDocument: 'after', session, timestamps: false }
        );
        expect(lockPromo.mock.invocationCallOrder[0]).toBeLessThan(countUses.mock.invocationCallOrder[0]);
        expect(usageCount).toHaveBeenCalledWith(session);
        expect(existingUsage).toHaveBeenCalledWith(session);
        expect(insertUsage).toHaveBeenCalledExactlyOnceWith([{
            _id: `PCU-WALLET-${checkoutId}`,
            code: 'SAVE10',
            user: 'member1',
            checkoutId,
            transaction: 'PAY-1',
            reservation: 'RES-1',
            paymentIds: ['PAY-1', 'PAY-2'],
            reservationIds: ['RES-1', 'RES-2'],
            originalDeposit: 30.10,
            discountAmount: 3.02,
            finalDeposit: 27.08
        }], { session });
    });

    it('uses the payment ID for card redemption and skips an existing usage on retry', async () => {
        const cardRedemption = {
            promoCode: 'SAVE10', userId: 'member1', paymentId: 'PAY-3',
            paymentIds: ['PAY-3'], reservationIds: ['RES-1', 'RES-2'], pricing, session
        };
        await recordPromoRedemption(cardRedemption);
        expect(insertUsage).toHaveBeenCalledWith([expect.objectContaining({
            _id: 'PCU-CARD-PAY-3', transaction: 'PAY-3',
            paymentIds: ['PAY-3'], reservationIds: ['RES-1', 'RES-2']
        })], { session });

        existingUsage.mockResolvedValueOnce({ _id: 'PCU-CARD-PAY-3' });
        await recordPromoRedemption(cardRedemption);
        expect(findUsage).toHaveBeenNthCalledWith(2, { _id: 'PCU-CARD-PAY-3' });
        expect(lockPromo).toHaveBeenCalledOnce();
        expect(insertUsage).toHaveBeenCalledOnce();
    });

    it('rechecks the usage cap after acquiring the promo document lock', async () => {
        usageCount.mockResolvedValueOnce(promo.maxUses);

        await expect(recordPromoRedemption(walletRedemption)).rejects.toMatchObject({
            code: 'PROMO_USAGE_LIMIT_REACHED'
        });
        expect(lockPromo.mock.invocationCallOrder[0]).toBeLessThan(countUses.mock.invocationCallOrder[0]);
        expect(insertUsage).not.toHaveBeenCalled();
    });

    it.each([
        [{ ...promo, expiresAt: new Date(0) }, 'PROMO_EXPIRED'],
        [{ ...promo, active: false }, 'PROMO_NO_LONGER_VALID'],
        [{ ...promo, minimumDeposit: 11 }, 'PROMO_NO_LONGER_VALID'],
        [{ ...promo, discountPercent: 20 }, 'PROMO_NO_LONGER_VALID']
    ])('rejects a promo that no longer matches the saved quote with %s', async (record, code) => {
        lockedResult.mockResolvedValueOnce(record);
        await expect(recordPromoRedemption(walletRedemption)).rejects.toMatchObject({ code });
        expect(insertUsage).not.toHaveBeenCalled();
    });

    it('requires an active transaction before touching the database', async () => {
        await expect(recordPromoRedemption({ ...walletRedemption, session: null }))
            .rejects.toThrow('An active MongoDB transaction is required');
        expect(findUsage).not.toHaveBeenCalled();
    });
});
