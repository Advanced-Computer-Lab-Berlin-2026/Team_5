import { request } from './client.js';

// Paying for the whole borrow list (members only). Each attempt has its own idempotency key: a retry of the same attempt
// sends the same key, so the server never charges twice.
const withKey = (key) => ({ 'Idempotency-Key': key });

// Pays from the wallet. Resolves to { checkoutId, reservations, totalDeposit, originalTotal, promoCode, remainingBalance, replayed }
export const quoteCheckout = promoCode => request('/api/wallet/checkout/quote', { method: 'POST', body: promoCode ? { promoCode } : {} });

export const payWithWallet = (key, promoCode) =>
    request('/api/wallet/checkout', { method: 'POST', headers: withKey(key), body: promoCode ? { promoCode } : {} });

// Starts a card payment. Resolves to { paymentId, clientSecret, amount (cents), currency }. The bookings are made once Stripe
// confirms the payment to the server, so afterwards poll getCardPaymentStatus.
export const startCardPayment = (key, promoCode) =>
    request('/api/stripe/payment-intent', { method: 'POST', headers: withKey(key), body: promoCode ? { promoCode } : {} });

// { paymentId, status: 'awaiting_payment' | 'completed' | 'refund_pending' | 'refunded', amount, reservations }
export const getCardPaymentStatus = (paymentId) => request(`/api/stripe/payments/${encodeURIComponent(paymentId)}/status`);

// Checks a promo code against one item. { code, discountPercent, discountAmount, discountedDeposit, ... }
export const validatePromoCode = (code, itemId) => request('/api/promo-codes/validate', { method: 'POST', body: { code, itemId } });

// a fresh key for a new checkout attempt
export const newIdempotencyKey = () => (window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);
