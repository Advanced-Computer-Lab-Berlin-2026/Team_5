import { request } from './client.js';

export const searchMember = (query) => request('/api/household/search', { query: { query } });

export const sendHouseholdRequest = (emailOrPhone, relation) =>
    request('/api/household/requests', { method: 'POST', body: { emailOrPhone, relation } });

export const getIncomingRequests = () => request('/api/household/requests/incoming');

// decision is 'accept' or 'decline'
export const respondToRequest = (requestId, decision) =>
    request(`/api/household/requests/${encodeURIComponent(requestId)}`, {
        method: 'PATCH',
        body: { decision }
    });

export const getLinks = () => request('/api/household/links');

export const removeLink = (linkId) =>
    request(`/api/household/links/${encodeURIComponent(linkId)}`, { method: 'DELETE' });
