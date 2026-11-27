import { request } from './client.js';

export const listItems = ({ page, limit, category, search, startDate, endDate } = {}) =>
    request('/api/items', { query: { page, limit, category, search, startDate, endDate } });

export const getItem = (id) => request(`/api/items/${encodeURIComponent(id)}`);

// date ranges that are already booked, as [{ startDate, endDate }]. Needs a login
export const getItemCalendar = (id) => request(`/api/items/${encodeURIComponent(id)}/calendar`);

// similar items from the same category, as { items }
export const getAlternatives = (id, query) => request(`/api/alternatives/${encodeURIComponent(id)}`, { query });
