import { PromoCode } from '../models/PromoCode.js';
import { PromoCodeUsage } from '../models/PromoCodeUsage.js';
import { CheckoutError } from '../utils/CheckoutError.js';

async function getPromoError(promo, lowestItemDeposit, session) {
    if (!promo?.active) {
        return new CheckoutError(
            409, 'PROMO_NO_LONGER_VALID', 'Promo code is invalid or inactive.'
        );
    }

    if (promo.expiresAt && promo.expiresAt <= new Date()) {
        return new CheckoutError(409, 'PROMO_EXPIRED', 'Promo code has expired.');
    }

    if (promo.maxUses !== null && promo.maxUses !== undefined) {
        const count = await PromoCodeUsage.countDocuments({ code: promo._id })
            .session(session);
        if (count >= promo.maxUses) {
            return new CheckoutError(
                409, 'PROMO_USAGE_LIMIT_REACHED', 'Promo code usage limit has been reached.'
            );
        }
    }

    if (lowestItemDeposit < (promo.minimumDeposit ?? 0)) {
        return new CheckoutError(
            409, 'PROMO_NO_LONGER_VALID', 'A deposit does not meet the promo code minimum.'
        );
    }

    if (!Number.isFinite(promo.discountPercent) ||
        promo.discountPercent < 1 || promo.discountPercent > 100) {
        return new CheckoutError(409, 'PROMO_NO_LONGER_VALID', 'Promo discount is invalid.');
    }

    return null;
}

export async function validatePromoCode(promoCode, userId, lowestItemDeposit, session = null) {
    if (!userId || !Number.isFinite(lowestItemDeposit)) {
        return { valid: false };
    }

    const code = promoCode.trim().toUpperCase();
    const promo = await PromoCode.findOne({ code }).session(session).lean();
    if (await getPromoError(promo, lowestItemDeposit, session)) {
        return { valid: false };
    }

    return { valid: true, code: promo.code, discountPercent: promo.discountPercent };
}

export async function recordPromoRedemption({
    promoCode,
    userId,
    checkoutId,
    paymentId,
    paymentIds,
    reservationIds,
    pricing,
    session
}) {
    if (!session?.inTransaction()) {
        throw new Error('An active MongoDB transaction is required for promo redemption.');
    }

    if ((!checkoutId && !paymentId) || !paymentIds.length || !reservationIds.length) {
        throw new Error('Missing checkout, payment, or reservation references for promo redemption.');
    }

    const usageId = checkoutId
        ? `PCU-WALLET-${checkoutId}`
        : `PCU-CARD-${paymentId}`;

    if (await PromoCodeUsage.exists({ _id: usageId }).session(session)) {
        return;
    }

    const { originalTotal, totalDeposit, lowestItemDeposit, discountPercent } = pricing;
    const originalCents = Math.round(originalTotal * 100);
    const finalCents = Math.round(totalDeposit * 100);
    if (!Number.isFinite(originalTotal) || !Number.isFinite(totalDeposit) ||
        !Number.isFinite(lowestItemDeposit) || lowestItemDeposit < 0 ||
        !Number.isSafeInteger(originalCents) || !Number.isSafeInteger(finalCents) ||
        finalCents < 0 || finalCents > originalCents) {
        throw new CheckoutError(
            409, 'PROMO_NO_LONGER_VALID', 'Saved promo pricing is invalid.'
        );
    }

    // Increment the version before counting uses. Concurrent writers for this code
    // must contend on the same document and retry with a fresh transaction snapshot.
    const promo = await PromoCode.findOneAndUpdate(
        { code: promoCode.trim().toUpperCase() },
        { $inc: { __v: 1 } },
        { returnDocument: 'after', session, timestamps: false }
    ).lean();

    const promoError = await getPromoError(promo, lowestItemDeposit, session);
    if (promoError) throw promoError;

    if (promo.discountPercent !== discountPercent) {
        throw new CheckoutError(
            409, 'PROMO_NO_LONGER_VALID', 'Promo discount changed after checkout was priced.'
        );
    }

    await PromoCodeUsage.create([{
        _id: usageId,
        code: promo._id,
        user: userId,
        checkoutId,
        transaction: paymentIds[0],
        reservation: reservationIds[0],
        paymentIds,
        reservationIds,
        originalDeposit: originalCents / 100,
        discountAmount: (originalCents - finalCents) / 100,
        finalDeposit: finalCents / 100
    }], { session });
}
