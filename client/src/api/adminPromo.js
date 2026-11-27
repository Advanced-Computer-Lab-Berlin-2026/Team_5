import { request } from './client.js';

const BASE = '/api/admin/promo-codes';

// { code (3-32, A-Z 0-9 _ -), discountPercent (1-100), expiresAt?, maxUses?, minimumDeposit? }. 409 if the code exists
export const createPromoCode = (fields) => request(BASE, { method: 'POST', body: fields });

// { promoCodes: [{ code, discountPercent, minimumDeposit, expiresAt, maxUses, redemptionCount, status }] }
export const listPromoCodes = () => request(BASE);

// filters: { code?, from?, to? }. { totalRedemptions, totalDiscountIssued, summary: [{ code, redemptions, discountIssued }], redemptions }
export const getPromoUsage = (filters = {}) => request(`${BASE}/usage`, { query: filters });
