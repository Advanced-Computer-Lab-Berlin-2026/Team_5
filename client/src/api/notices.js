import { request } from './client.js';

export const listNotices = () => request('/api/notices');

// admin only
export const createNotice = (title, body) =>
    request('/api/admin/notices', { method: 'POST', body: { title, body } });
