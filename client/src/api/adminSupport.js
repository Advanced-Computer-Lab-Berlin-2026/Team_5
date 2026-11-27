import { request } from './client.js';

// status: in-progress | resolved | all. { tickets } with the asker filled in
export const listSupportTickets = (status) => request('/api/admin/support-tickets', { query: { status } });

// answers a ticket; resolve: true closes it. 409 once it is resolved
export const respondToTicket = (id, message, resolve = false) =>
    request(`/api/admin/support-tickets/${encodeURIComponent(id)}/respond`, { method: 'POST', body: { message, resolve } });
