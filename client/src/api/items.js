import { request } from './client.js';

export const listItems = ({ page, limit, category, search } = {}) =>
    request('/api/items', { query: { page, limit, category, search } });

export const getItem = (id) => request(`/api/items/${encodeURIComponent(id)}`);
