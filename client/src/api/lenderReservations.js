import { request } from './client.js';

const BASE = '/api/lender/reservations';

export const markPickedUp = (id) =>
    request(`${BASE}/${encodeURIComponent(id)}/pickup`, { method: 'PATCH' });

// marks the item as returned in good condition, which refunds the borrower's deposit
export const markReturnedGood = (id) =>
    request(`${BASE}/${encodeURIComponent(id)}/return`, { method: 'PATCH' });

// stage: 'pickup' | 'return'. files: File[] (JPG or PNG, at most 5 MB each, at most 5 per stage)
export function uploadConditionPhotos(id, stage, files) {
    const form = new FormData();
    files.forEach((file) => form.append('photos', file));
    return request(`${BASE}/${encodeURIComponent(id)}/photos/${stage}`, { method: 'POST', body: form });
}

// fields: { returnCondition, message }. files: optional extra photos. They are added to the return photos,
// and the report gets all return photos. At least one photo must exist in total (at most 5).
export function reportDamage(id, { returnCondition, message }, files = []) {
    const form = new FormData();
    form.append('returnCondition', returnCondition);
    form.append('message', message);
    files.forEach((file) => form.append('photos', file));
    return request(`${BASE}/${encodeURIComponent(id)}/damage`, { method: 'POST', body: form });
}