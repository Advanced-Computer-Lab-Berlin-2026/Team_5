
import { CheckoutError } from '../utils/CheckoutError.js';
import { validatePromoCode } from './promoCodeService.js';

// A missing promo and an empty promo are not equivalent: whitespace-only input is invalid.
export function normalizePromoCode(promoCode = null) {
    if (promoCode === null || promoCode === undefined || promoCode === '') {
        return null;
    }
    if (typeof promoCode !== 'string' || !promoCode.trim() || promoCode.length > 128) {
        throw new CheckoutError(400, 'INVALID_PROMO_CODE', 'Invalid promo code.');
    }
    return promoCode.trim().toUpperCase();
}

export async function calculateCheckoutPricing(userId, checkoutItems, promoCode = null, session = null) {
    const normalizedPromo = normalizePromoCode(promoCode);

    const originalCents = checkoutItems.map(item => {
        if (typeof item.depositAmount !== 'number' || !Number.isFinite(item.depositAmount)) {
            throw new Error('Invalid deposit amount.');
        }
        const value = item.depositAmount * 100;
        const cents = Math.round(value);

        if (!Number.isSafeInteger(cents) || cents < 0 ||
            Math.abs(value - cents) > 0.000001) {
            throw new Error('Invalid deposit amount.');
        }

        return cents;
    });

    const originalTotalCents = originalCents.reduce((sum, value) => sum + value, 0);
    if (!Number.isSafeInteger(originalTotalCents)) {
        throw new Error('Checkout total exceeds supported range.');
    }

    let discountPercent = 0;
    let validatedCode = null;
    let lowestItemDeposit;
    let finalCents = originalCents;

    if (normalizedPromo) {
        lowestItemDeposit = checkoutItems.reduce(
            (lowest, item) => Math.min(lowest, item.depositAmount),
            Infinity
        );
        const promo = await validatePromoCode(
            normalizedPromo, userId, lowestItemDeposit, session
        );

        if (!promo?.valid) {
            throw new CheckoutError(400, 'INVALID_PROMO_CODE', 'Promo code is not valid.');
        }

        if (!Number.isFinite(promo.discountPercent) ||
            promo.discountPercent < 1 || promo.discountPercent > 100) {
            throw new Error('Invalid discount percentage returned by promo service.');
        }

        discountPercent = promo.discountPercent;
        validatedCode = normalizePromoCode(promo.code) ?? normalizedPromo;

        // Round the discount on each item as the promo validation endpoint does.
        finalCents = checkoutItems.map(({ depositAmount }) => {
            const discountAmount = Math.round(depositAmount * discountPercent) / 100;
            return Math.round((depositAmount - discountAmount) * 100);
        });
    }

    const totalCents = finalCents.reduce((sum, value) => sum + value, 0);
    const items = checkoutItems.map((item, index) => ({
        ...item,
        depositAmount: finalCents[index] / 100
    }));

    return {
        items,
        originalTotal: originalTotalCents / 100,
        totalDeposit: totalCents / 100,
        totalCents,
        discountPercent,
        promoCode: validatedCode,
        lowestItemDeposit
    };
}
