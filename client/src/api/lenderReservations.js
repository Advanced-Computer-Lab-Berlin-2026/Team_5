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

// pending requests for this lender's items, oldest first. Resolves to { reservations }
export const listIncomingReservations = () => request(BASE);

// approved and in-progress bookings of this lender's items, soonest first. { reservations } with item (name, photos) and borrower
export const listCompletedReservations = () => request(BASE, { query: { view: 'completed' } });
export const listAcceptedReservations = () => request(BASE, { query: { view: 'accepted' } });

// approving makes the booking "upcoming" (and blocks those dates); rejecting refunds the deposit to the borrower
export const approveReservation = (id) => request(`${BASE}/${encodeURIComponent(id)}/approve`, { method: 'PATCH' });
export const rejectReservation = (id) => request(`${BASE}/${encodeURIComponent(id)}/reject`, { method: 'PATCH' });

// extension requests waiting for this lender: { requests: [{ requestId, reservationId, originalEndDate, requestedEndDate, borrower, item (id) }] }
export const listPendingExtensions = () => request(`${BASE}/extensions/pending`);

// decision: 'accept' (the end date moves) or 'reject'
export const decideExtension = (reservationId, requestId, decision) =>
    request(`${BASE}/${encodeURIComponent(reservationId)}/extensions/${encodeURIComponent(requestId)}`, { method: 'PATCH', body: { decision } });
