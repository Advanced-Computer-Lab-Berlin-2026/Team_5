import { request } from './client.js';

export const listNotifications = ({ page, limit } = {}) => request('/api/notifications', { query: { page, limit } });

export const markNotificationRead = (id) => request(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
