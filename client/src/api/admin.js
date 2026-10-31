import { request } from './client.js';

export const listUsers = () => request('/api/admin/users');

// Needs MongoDB Atlas Search; on a plain local MongoDB the server answers with an error.
export const searchUsers = (name) => request('/api/admin/users/search', { query: { name } });

export const getUser = (id) => request(`/api/admin/users/${encodeURIComponent(id)}`);

export const setSuspension = (id, suspended) =>
    request(`/api/admin/users/${encodeURIComponent(id)}/suspension`, {
        method: 'PATCH',
        body: { suspended }
    });

export const deleteUser = (id) =>
    request(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const createAdmin = (fields) => request('/api/admin/users/admins', { method: 'POST', body: fields });

export const listAllItems = () => request('/api/admin/items');

// value must be a number of at least 1
export const setDepositMultiplier = (categoryId, depositMultiplier) =>
    request(`/api/admin/categories/${encodeURIComponent(categoryId)}/deposit-multiplier`, {
        method: 'PATCH',
        body: { depositMultiplier }
    });

// status is 'pending', 'accepted' or 'rejected'. The server answers with a plain array of users.
export const listLenderRequests = (status) =>
    request('/api/admin/lender-requests', { query: { status } });

export const getLenderRequest = (username) =>
    request(`/api/admin/lender-requests/${encodeURIComponent(username)}`);

// decision is 'accept' or 'reject'; a reason is required when rejecting
export const decideLenderRequest = (username, decision, reason) =>
    request(`/api/admin/lender-requests/${encodeURIComponent(username)}/decision`, {
        method: 'PATCH',
        body: decision === 'reject' ? { decision, reason } : { decision }
    });

// A link, not a request: the server redirects to a signed Cloudinary URL, so it opens in a new tab.
export const lenderDocumentUrl = (username, slot) =>
    `/api/admin/lender-requests/${encodeURIComponent(username)}/documents/${slot}`;
