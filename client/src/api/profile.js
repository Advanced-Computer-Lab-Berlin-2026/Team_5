import { request } from './client.js';

// fields: { phoneNumber?, homeAddress? }, at least one is required by the server
export const updateProfile = (fields) =>
    request('/api/profile', { method: 'PATCH', body: fields });
