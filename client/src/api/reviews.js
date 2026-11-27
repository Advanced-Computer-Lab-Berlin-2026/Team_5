import { request } from './client.js';

const BASE = '/api/reviews';
const forReservation = (id, who) => `${BASE}/reservations/${encodeURIComponent(id)}/${who}`;

// rating is 1 to 5, review is 1 to 500 characters. Only for completed reservations, once each.
// The borrower reviews the lender...
export const reviewLender = (id, { rating, review }) => request(forReservation(id, 'lender'), { method: 'POST', body: { rating, review } });
// ...and the lender reviews the borrower.
export const reviewBorrower = (id, { rating, review }) => request(forReservation(id, 'borrower'), { method: 'POST', body: { rating, review } });

// { given: [{ reservationId, targetUser, targetRole, rating, review, date }], received: [{ reservationId, role, reviewer, rating, review, date }] }
export const getMyReviews = () => request(`${BASE}/me`);

// someone's trust score and the reviews they received: { user: { username, name, role, trustScore }, reviews: [...] }
export const getUserReviews = (username) => request(`${BASE}/users/${encodeURIComponent(username)}`);
