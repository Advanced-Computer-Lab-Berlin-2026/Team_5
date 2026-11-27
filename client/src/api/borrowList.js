import { request } from './client.js';

const BASE = '/api/borrow-list';
const entry = (itemId) => `${BASE}/${encodeURIComponent(itemId)}`;

// The items someone wants to borrow, with their dates, before paying for them all at once.
// { borrowList: [{ item: { _id, name, category, photos, depositAmount, ... }, startDate, endDate }] }
export const getBorrowList = () => request(BASE);

// dates are YYYY-MM-DD. 409 when the dates are taken or the item is already in the list
export const addToBorrowList = (itemId, { startDate, endDate, deliveryAddress }) =>
    request(entry(itemId), { method: 'POST', body: { startDate, endDate, deliveryAddress } });

export const updateBorrowListDates = (itemId, { startDate, endDate }) => request(entry(itemId), { method: 'PATCH', body: { startDate, endDate } });

export const removeFromBorrowList = (itemId) => request(entry(itemId), { method: 'DELETE' });
