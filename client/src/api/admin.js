import { request } from './client.js';

export const listUsers = () => request('/api/admin/users');

export const getUser = (id) => request(`/api/admin/users/${encodeURIComponent(id)}`);

export const setSuspension = (id, suspended) =>
    request(`/api/admin/users/${encodeURIComponent(id)}/suspension`, {
        method: 'PATCH',
        body: { suspended }
    });

export const deleteUser = (id) =>
    request(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const listAllItems = () => request('/api/admin/items');
