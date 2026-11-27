import { request } from './client.js';

export const listItems = ({ page, limit, category, search } = {}) =>
    request('/api/items', { query: { page, limit, category, search } });

export const getItem = (id) => request(`/api/items/${encodeURIComponent(id)}`);

// date ranges that are already booked, as [{ startDate, endDate }]. Needs a login
export const getItemCalendar = (id) => request(`/api/items/${encodeURIComponent(id)}/calendar`);

// similar items from the same category, as { items }
export const getAlternatives = (id) => request(`/api/alternatives/${encodeURIComponent(id)}`);
