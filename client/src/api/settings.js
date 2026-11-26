import { request } from './client.js';

// members and lenders. { emailPreferences: { reservations, promotions, communityNotices } }
export const getEmailPreferences = () => request('/api/settings/email-preferences');

export const updateEmailPreferences = (preferences) => request('/api/settings/email-preferences', { method: 'PATCH', body: preferences });
