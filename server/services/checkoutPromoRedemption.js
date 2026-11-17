import * as promoCodeService from './promoCodeService.js';
import { CheckoutError } from '../utils/CheckoutError.js';

// SCRUM-531 is owned by the promo-code teammate. This adapter defines the
// checkout interface without silently skipping the mandatory redemption.
export function requirePromoRedemptionSupport() {
    if (typeof promoCodeService.recordPromoRedemption !== 'function') {
        throw new CheckoutError(
            503,
            'PROMO_REDEMPTION_NOT_READY',
            'Promo checkout is unavailable until redemption tracking is enabled.'
        );
    }
}

// Called once per successful checkout, in the existing MongoDB transaction.
// Ziad must enforce maxUses ATOMICALLY here (not just in validation),
// and make the operation idempotent for the checkoutId/paymentId.
export async function redeemCheckoutPromo({
    promoCode,
    userId,
    checkoutId = null,
    paymentId = null,
    paymentIds = [],
    reservationIds = [],
    session
}) {
    if (!promoCode) return;
    requirePromoRedemptionSupport();
    if (!session?.inTransaction?.()) {
        throw new Error('A MongoDB transaction is required for promo redemption.');
    }

    await promoCodeService.recordPromoRedemption({
        promoCode,
        userId,
        checkoutId,
        paymentId,
        paymentIds,
        reservationIds,
        session
    });
}
