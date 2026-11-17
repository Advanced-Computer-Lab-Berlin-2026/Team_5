import { CheckoutError } from '../utils/CheckoutError.js';

// Temporary placeholder until your teammate implements validation.
export async function validatePromoCode(promoCode, userId) {
    throw new CheckoutError(
        503,
        'PROMO_VALIDATION_NOT_READY',
        'Promo-code validation is not implemented yet.'
    );
}