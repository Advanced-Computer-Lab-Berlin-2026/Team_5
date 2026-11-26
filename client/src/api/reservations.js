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
