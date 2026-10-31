import { request } from './client.js';

const BASE = '/api/lender/items';

export const listMyItems = () => request(BASE);

// fields: see ItemForm. The server accepts name, description, category, depositAmount,
// conditionNotes, pickupLocation, pickupInstructions and borrowingRules.
export const createItem = (fields) => request(BASE, { method: 'POST', body: fields });

export const updateItem = (id, fields) =>
    request(`${BASE}/${encodeURIComponent(id)}`, { method: 'PATCH', body: fields });

export const toggleArchive = (id) =>
    request(`${BASE}/${encodeURIComponent(id)}/archive`, { method: 'PATCH' });

// files: File[] (JPG or PNG, at most 5 MB each, at most 5 photos per item)
export function uploadPhotos(id, files) {
    const form = new FormData();
    files.forEach((file) => form.append('photos', file));
    return request(`${BASE}/${encodeURIComponent(id)}/photos`, { method: 'POST', body: form });
}

// file: a PDF of at most 10 MB. A new manual replaces the old one.
export function uploadManual(id, file) {
    const form = new FormData();
    form.append('manual', file);
    return request(`${BASE}/${encodeURIComponent(id)}/manual`, { method: 'PUT', body: form });
}
