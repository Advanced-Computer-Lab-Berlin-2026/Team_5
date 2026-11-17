
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

export async function calculateCheckoutPricing(userId, checkoutItems, promoCode = null) {
    const normalizedPromo = normalizePromoCode(promoCode);
    let discountPercent = 0;
    let validatedCode = null;

    if (normalizedPromo) {
        const promo = await validatePromoCode(normalizedPromo, userId);

        if (!promo?.valid) {
            throw new CheckoutError(400, 'INVALID_PROMO_CODE', 'Promo code is not valid.');
        }

        if (!Number.isFinite(promo.discountPercent) ||
            promo.discountPercent < 0 || promo.discountPercent > 100) {
            throw new Error('Invalid discount percentage returned by promo service.');
        }

        discountPercent = promo.discountPercent;
        validatedCode = typeof promo.code === 'string'
            ? normalizePromoCode(promo.code)
            : normalizedPromo;
    }

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
    const multiplier = 1 - discountPercent / 100;
    const totalCents = Math.round(originalTotalCents * multiplier);
    if (!Number.isSafeInteger(totalCents)) {
        throw new Error('Discounted checkout total exceeds supported range.');
    }

    // Allocate the total discount across items, including rounding cents.
    const exactAmounts = originalCents.map(value => value * multiplier);
    const allocated = exactAmounts.map(Math.floor);
    let remaining = totalCents - allocated.reduce((sum, value) => sum + value, 0);

    const order = exactAmounts.map((value, index) => ({
        index,
        fraction: value - allocated[index]
    })).sort((a, b) => b.fraction - a.fraction);

    for (let i = 0; i < remaining; i++) {
        allocated[order[i].index]++;
    }

    const items = checkoutItems.map((item, index) => ({
        ...item,
        depositAmount: allocated[index] / 100
    }));

    return {
        items,
        originalTotal: originalTotalCents / 100,
        totalDeposit: totalCents / 100,
        totalCents,
        discountPercent,
        promoCode: validatedCode
    };
}
