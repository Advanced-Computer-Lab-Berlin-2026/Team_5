import { request } from './client.js';

// members only. { tickets: [{ _id, subject, status: 'in-progress' | 'resolved', messages: [{ sender, text, date, userType }], updatedAt }] }
export const listMyTickets = () => request('/api/support-tickets');

// subject 3 to 120 characters, message up to 5000
export const openTicket = ({ subject, message }) => request('/api/support-tickets', { method: 'POST', body: { subject, message } });
