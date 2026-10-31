import { request } from './client.js';

const BASE = '/api/lender-requests';

// Returns the member's verification: { status, note, documents, submittedAt, ... }
export const getMyRequest = () => request(BASE);

// slot is 'id' or 'addressProof'; file is a PDF, JPG or PNG of at most 5 MB
export function uploadDocument(slot, file) {
    const form = new FormData();
    form.append('file', file);
    return request(`${BASE}/documents/${slot}`, { method: 'POST', body: form });
}

export const removeDocument = (slot) => request(`${BASE}/documents/${slot}`, { method: 'DELETE' });

export const submitRequest = () => request(`${BASE}/submit`, { method: 'POST' });
