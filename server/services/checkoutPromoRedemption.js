import { recordPromoRedemption } from './promoCodeService.js';

export async function redeemCheckoutPromo(details) {
    if (!details.promoCode) return;
    await recordPromoRedemption(details);
}
