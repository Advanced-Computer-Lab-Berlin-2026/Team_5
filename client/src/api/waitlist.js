import { request } from './client.js';

// dates are YYYY-MM-DD
export const joinWaitlist = (itemId, { startDate, endDate }) =>
    request(`/api/waitlist/${encodeURIComponent(itemId)}`, { method: 'POST', body: { startDate, endDate } });

// the id is a waitlist entry id (WTL-...), or an item id to leave every entry for that item
export const leaveWaitlist = (id) => request(`/api/waitlist/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const getWaitlist = () => request('/api/waitlist');
