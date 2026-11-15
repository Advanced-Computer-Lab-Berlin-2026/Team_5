import { request } from './client.js';

const BASE = '/api/lender/reservations';

export const markPickedUp = (id) =>
    request(`${BASE}/${encodeURIComponent(id)}/pickup`, { method: 'PATCH' });

// marks the item as returned in good condition, which refunds the borrower's deposit
export const markReturnedGood = (id) =>
    request(`${BASE}/${encodeURIComponent(id)}/return`, { method: 'PATCH' });