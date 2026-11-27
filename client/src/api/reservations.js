import { request } from './client.js';

const BASE = '/api/reservations';

// dates are YYYY-MM-DD. deliveryAddress is needed when deliveryFlag is true. Resolves to { reservationId }
export const createReservation = ({ itemId, startDate, endDate, deliveryFlag = false, deliveryAddress }) =>
    request(BASE, { method: 'POST', body: { itemId, startDate, endDate, deliveryFlag, ...(deliveryFlag ? { deliveryAddress } : {}) } });

export const getDelivery = (id) => request(`${BASE}/${encodeURIComponent(id)}/delivery`);

// lender or admin. status: 'preparing' | 'out-for-delivery' | 'delivered'
export const updateDelivery = (id, status) => request(`${BASE}/${encodeURIComponent(id)}/delivery`, { method: 'POST', body: { status } });

export const listMessages = (id) => request(`${BASE}/${encodeURIComponent(id)}/messages`);

export const sendMessage = (id, text) => request(`${BASE}/${encodeURIComponent(id)}/messages`, { method: 'POST', body: { text } });

// the reservations I booked as a borrower, newest start first. query: { status, view: 'upcoming' | 'past', from, to }
export const getMyReservations = (query) => request(BASE, { query });

// borrower: only while pending or upcoming. Resolves to { reservation, refunded }
export const cancelReservation = (id) => request(`${BASE}/${encodeURIComponent(id)}/cancel`, { method: 'PATCH' });

// borrower (members only), while the booking is active: asks the lender to move the end date. 201 { requestId, status, ... }
// 409 when one is already waiting or the extra days are taken
export const requestExtension = (id, requestedEndDate) =>
    request(`${BASE}/${encodeURIComponent(id)}/extensions`, { method: 'POST', body: { requestedEndDate } });
