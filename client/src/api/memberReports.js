import { request } from './client.js';

// members only: reports an item or a person to the admins. targetType 'item' | 'user', targetId the item id or username,
// reason 5 to 500 characters
export const submitReport = ({ targetType, targetId, reason }) => request('/api/reports', { method: 'POST', body: { targetType, targetId, reason } });
