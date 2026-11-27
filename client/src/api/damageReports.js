import { request } from './client.js';

// caseNumber = the id of the lender's damage report (DMG-xxxxxxxx).
// Admins find cases with the damage list in GET /api/admin/reports/damage (each case has its case number in `id`).

const ADMIN_BASE = '/api/admin/damage-reports';
const BASE = '/api/damage-reports';
const caseUrl = (base, caseNumber) => `${base}/${encodeURIComponent(caseNumber)}`;

export const getDamageCaseForReservation = id => request(`${BASE}/reservation/${encodeURIComponent(id)}`);

// Admin: one case with beforePhotos (pickup), afterPhotos (return) and every step in order
export const getDamageCase = (caseNumber) =>
    request(caseUrl(ADMIN_BASE, caseNumber));

// Admin: first ruling. Money moves now: depositForfeit goes to the lender, the rest back to the borrower.
export const decideDamageCase = (caseNumber, { depositForfeit, message }) =>
    request(`${caseUrl(ADMIN_BASE, caseNumber)}/decision`, { method: 'POST', body: { depositForfeit, message } });

// Admin: final ruling on a disputed case. Only the difference to the decision moves.
export const resolveDamageCase = (caseNumber, { depositForfeit, message }) =>
    request(`${caseUrl(ADMIN_BASE, caseNumber)}/resolution`, { method: 'POST', body: { depositForfeit, message } });

// Borrower: disputes the admin's decision within 7 days. files: optional photos (JPG or PNG, at most 5).
export function disputeDamageCase(caseNumber, message, files = []) {
    const form = new FormData();
    form.append('message', message);
    files.forEach((file) => form.append('photos', file));
    return request(`${caseUrl(BASE, caseNumber)}/dispute`, { method: 'POST', body: form });
}

// Admin, borrower or lender of the case: the PDF is a file download, not JSON, so use this URL
// in a link instead of request(), e.g. <a href={damageCasePdfUrl(caseNumber)}>Download PDF</a>.
// The browser sends the login cookie with it.
export const damageCasePdfUrl = (caseNumber) => `${caseUrl(BASE, caseNumber)}/pdf`;
