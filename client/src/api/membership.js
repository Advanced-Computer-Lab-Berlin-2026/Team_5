import { request } from './client.js';

// { tiers: [{ tier, annual_fee, deposit_discount }] }, cheapest first
export const listMembershipTiers = () => request('/api/membership-tiers');

// { membership: { tier, startDate, renewalDate } }
export const getMyMembership = () => request('/api/membership');

// method: 'wallet' | 'card'. Needs an idempotency key per attempt (the same one on a retry).
// Wallet: { status: 'completed', membership, ... }. Card: { status: 'awaiting_payment', clientSecret, amount (cents), ... },
// and the tier changes once Stripe confirms the payment to the server.
export const subscribeToTier = (key, tier, method) =>
    request('/api/membership/subscribe', { method: 'POST', headers: { 'Idempotency-Key': key }, body: { tier, method } });

// back to Basic straight away; nothing is refunded
export const cancelMembership = () => request('/api/membership/cancel', { method: 'POST' });
