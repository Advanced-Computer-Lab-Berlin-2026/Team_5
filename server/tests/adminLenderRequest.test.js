import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../app.js";
import { env } from "../config/env.js";
import { User } from "../models/User.js";
import { getSignedDocumentUrl } from "../config/cloudinary.js";

// Mock the User model: the lender request is stored in the applicant's verification field.
vi.mock('../models/User.js', () => ({
    User: { find: vi.fn(), findById: vi.fn() }
}));

// Mock Cloudinary: tests never create real links and do not need the Cloudinary keys.
vi.mock('../config/cloudinary.js', () => ({
    getSignedDocumentUrl: vi.fn()
}));

const ADMIN_ID = 'admin1';
const APPLICANT_ID = 'sara123';
const BASE_URL = '/api/admin/lender-requests';
const USER_FIELDS = 'username profile verification';
const ORIGIN = 'http://localhost:3000';
const SIGNED_URL = 'https://res.cloudinary.com/demo/image/authenticated/s--signature--/v1/lender-documents/sara-id.png';

const idDocument = { type: 'id', file: { url: 'https://res.cloudinary.com/demo/sara-id' }, originalName: 'passport.png', storedName: 'lender-documents/sara-id', docType: 'image/png', size: 8 };
const addressProof = { type: 'addressProof', file: { url: 'https://res.cloudinary.com/demo/sara-proof' }, originalName: 'proof.pdf', storedName: 'lender-documents/sara-proof', docType: 'application/pdf', size: 8 };

// The applicant the controller loads, and the role of the logged-in user the auth middleware loads.
let applicant;
let loggedInRole;

// An applicant the way findById returns it: a member with a pending request and both documents.
function fakeApplicant(verification = {}) {
    return {
        _id: APPLICANT_ID,
        username: APPLICANT_ID,
        role: 'member',
        suspended: false,
        wallet: 100,
        profile: { name: 'Sara', email: 'sara@example.com' },
        verification: { status: 'pending', documents: [idDocument, addressProof], ...verification },
        save: vi.fn().mockResolvedValue()
    };
}

// findById is used twice per request: by the auth middleware for the admin, and by the controller for the applicant.
function findUserById(id) {
    if (id === ADMIN_ID) return Promise.resolve({ _id: ADMIN_ID, role: loggedInRole, suspended: false });
    return Promise.resolve(id === APPLICANT_ID ? applicant : null);
}

// The auth middleware still finds the admin, but loading the applicant fails.
function failApplicantLookup() {
    User.findById.mockImplementation((id) => id === ADMIN_ID ? findUserById(id) : Promise.reject(new Error('Database unavailable')));
}

function loginCookie(role) {
    loggedInRole = role;
    return `accessToken=${jwt.sign({ id: ADMIN_ID, role }, env.jwtSecret, { expiresIn: '15m' })}`;
}

// Sends the request as a logged-in admin from the trusted origin.
function asAdmin(req) {
    return req.set('Cookie', loginCookie('admin')).set('Origin', ORIGIN);
}

beforeEach(() => {
    vi.resetAllMocks();

    applicant = fakeApplicant();
    User.findById.mockImplementation(findUserById);
    User.find.mockReturnValue({ select: vi.fn().mockReturnValue({ sort: vi.fn().mockResolvedValue([applicant]) }) });
    getSignedDocumentUrl.mockReturnValue(SIGNED_URL);
});

const protectedUrls = [
    `${BASE_URL}`,
    `${BASE_URL}/${APPLICANT_ID}`,
    `${BASE_URL}/${APPLICANT_ID}/documents/id`
];

describe('Admin access', () => {
    it.each(protectedUrls)('returns 401 for %s when not logged in', async (url) => {
        const response = await request(app).get(url);

        expect(response.status).toBe(401);
    });

    it.each(protectedUrls)('returns 403 for %s when the user is not an admin', async (url) => {
        const response = await request(app)
            .get(url)
            .set('Cookie', loginCookie('member'));

        expect(response.status).toBe(403);
        expect(User.find).not.toHaveBeenCalled();
        expect(User.findById).not.toHaveBeenCalledWith(APPLICANT_ID);
    });
});

describe('GET /api/admin/lender-requests', () => {
    it('returns 200 with the pending requests by default', async () => {
        const response = await asAdmin(request(app).get(BASE_URL));

        expect(response.status).toBe(200);
        expect(response.body).toHaveLength(1);
        expect(response.body[0].profile.name).toBe('Sara');
        expect(User.find).toHaveBeenCalledWith({ 'verification.status': 'pending' });

        const select = User.find.mock.results[0].value.select;
        expect(select).toHaveBeenCalledWith(USER_FIELDS);
        expect(select.mock.results[0].value.sort).toHaveBeenCalledWith({ 'verification.submittedAt': -1 });
    });

    it.each(['accepted', 'rejected'])('returns 200 and filters by status %s', async (status) => {
        const response = await asAdmin(request(app).get(`${BASE_URL}?status=${status}`));

        expect(response.status).toBe(200);
        expect(User.find).toHaveBeenCalledWith({ 'verification.status': status });
    });

    it.each(['none', 'approved', 'banana'])('returns 400 for status %s', async (status) => {
        const response = await asAdmin(request(app).get(`${BASE_URL}?status=${status}`));

        expect(response.status).toBe(400);
        expect(User.find).not.toHaveBeenCalled();
    });

    it('returns 500 when the lookup fails', async () => {
        User.find.mockImplementation(() => { throw new Error('Database unavailable'); });

        const response = await asAdmin(request(app).get(BASE_URL));

        expect(response.status).toBe(500);
    });
});

describe('GET /api/admin/lender-requests/:username', () => {
    it('returns 200 with the user details and the request with its documents', async () => {
        const response = await asAdmin(request(app).get(`${BASE_URL}/${APPLICANT_ID}`));

        expect(response.status).toBe(200);
        expect(response.body.username).toBe(APPLICANT_ID);
        expect(response.body.profile.name).toBe('Sara');
        expect(response.body.verification.status).toBe('pending');
        expect(response.body.verification.documents).toHaveLength(2);
        expect(User.findById).toHaveBeenCalledWith(APPLICANT_ID);
    });

    it('does not send fields the admin does not need', async () => {
        const response = await asAdmin(request(app).get(`${BASE_URL}/${APPLICANT_ID}`));

        expect(response.body.wallet).toBeUndefined();
        expect(response.body.role).toBeUndefined();
    });

    it('returns 404 when the user does not exist', async () => {
        const response = await asAdmin(request(app).get(`${BASE_URL}/nobody`));

        expect(response.status).toBe(404);
        expect(response.body.message).toBe('Lender request not found');
    });

    it('returns 404 when the user never submitted a request', async () => {
        applicant = fakeApplicant({ status: 'none' });

        const response = await asAdmin(request(app).get(`${BASE_URL}/${APPLICANT_ID}`));

        expect(response.status).toBe(404);
    });

    it('returns 500 when the lookup fails', async () => {
        failApplicantLookup();

        const response = await asAdmin(request(app).get(`${BASE_URL}/${APPLICANT_ID}`));

        expect(response.status).toBe(500);
    });
});

describe('GET /api/admin/lender-requests/:username/documents/:slot', () => {
    it.each([
        { slot: 'id', document: idDocument },
        { slot: 'addressProof', document: addressProof }
    ])('redirects to a signed Cloudinary link to preview the $slot document', async ({ slot, document }) => {
        const response = await asAdmin(request(app).get(`${BASE_URL}/${APPLICANT_ID}/documents/${slot}`));

        expect(response.status).toBe(302);
        expect(response.headers.location).toBe(SIGNED_URL);
        expect(getSignedDocumentUrl).toHaveBeenCalledWith(document, false);
    });

    it('redirects to a download link with ?download=true', async () => {
        const response = await asAdmin(request(app).get(`${BASE_URL}/${APPLICANT_ID}/documents/addressProof?download=true`));

        expect(response.status).toBe(302);
        expect(getSignedDocumentUrl).toHaveBeenCalledWith(addressProof, true);
    });

    it('returns 400 for an invalid slot', async () => {
        const response = await asAdmin(request(app).get(`${BASE_URL}/${APPLICANT_ID}/documents/banana`));

        expect(response.status).toBe(400);
        expect(User.findById).not.toHaveBeenCalledWith(APPLICANT_ID);
    });

    it('returns 404 when the user does not exist', async () => {
        const response = await asAdmin(request(app).get(`${BASE_URL}/nobody/documents/id`));

        expect(response.status).toBe(404);
        expect(getSignedDocumentUrl).not.toHaveBeenCalled();
    });

    it('returns 404 when the document was not uploaded', async () => {
        applicant = fakeApplicant({ documents: [addressProof] });

        const response = await asAdmin(request(app).get(`${BASE_URL}/${APPLICANT_ID}/documents/id`));

        expect(response.status).toBe(404);
        expect(response.body.message).toBe('Document not found');
        expect(getSignedDocumentUrl).not.toHaveBeenCalled();
    });

    it('returns 500 when the lookup fails', async () => {
        failApplicantLookup();

        const response = await asAdmin(request(app).get(`${BASE_URL}/${APPLICANT_ID}/documents/id`));

        expect(response.status).toBe(500);
    });
});

const invalidDecisions = [
    {},
    { decision: 'maybe' },
    { decision: 'reject' },
    { decision: 'reject', reason: '   ' },
    { decision: 'accept', reason: 'Looks good' }
];

describe('PATCH /api/admin/lender-requests/:username/decision', () => {
    it('returns 200, accepts the request and makes the user a verified lender', async () => {
        const response = await asAdmin(request(app).patch(`${BASE_URL}/${APPLICANT_ID}/decision`))
            .send({ decision: 'accept' });

        expect(response.status).toBe(200);
        expect(response.body.verification.status).toBe('accepted');
        expect(applicant.role).toBe('lender');
        expect(applicant.verification.status).toBe('accepted');
        expect(applicant.verification.note).toBeUndefined();
        expect(applicant.verification.reviewedBy).toBe(ADMIN_ID);
        expect(applicant.verification.reviewedAt).toBeInstanceOf(Date);
        expect(applicant.save).toHaveBeenCalledOnce();
    });

    it('returns 200, rejects the request and stores the reason for the user', async () => {
        const response = await asAdmin(request(app).patch(`${BASE_URL}/${APPLICANT_ID}/decision`))
            .send({ decision: 'reject', reason: '  The ID document is blurry  ' });

        expect(response.status).toBe(200);
        expect(response.body.verification.status).toBe('rejected');
        expect(applicant.role).toBe('member');
        expect(applicant.verification.note).toBe('The ID document is blurry');
        expect(applicant.verification.reviewedBy).toBe(ADMIN_ID);
        expect(applicant.save).toHaveBeenCalledOnce();
    });

    it('returns 401 when not logged in', async () => {
        const response = await request(app)
            .patch(`${BASE_URL}/${APPLICANT_ID}/decision`).set('Origin', ORIGIN)
            .send({ decision: 'accept' });

        expect(response.status).toBe(401);
    });

    it('returns 403 when the user is not an admin', async () => {
        const response = await request(app)
            .patch(`${BASE_URL}/${APPLICANT_ID}/decision`).set('Origin', ORIGIN)
            .set('Cookie', loginCookie('member'))
            .send({ decision: 'accept' });

        expect(response.status).toBe(403);
        expect(applicant.save).not.toHaveBeenCalled();
    });

    it.each(invalidDecisions)('returns 400 for an invalid body %#', async (body) => {
        const response = await asAdmin(request(app).patch(`${BASE_URL}/${APPLICANT_ID}/decision`))
            .send(body);

        expect(response.status).toBe(400);
        expect(User.findById).not.toHaveBeenCalledWith(APPLICANT_ID);
        expect(applicant.save).not.toHaveBeenCalled();
    });

    it('returns 404 when the user does not exist', async () => {
        const response = await asAdmin(request(app).patch(`${BASE_URL}/nobody/decision`))
            .send({ decision: 'accept' });

        expect(response.status).toBe(404);
    });

    it.each(['accepted', 'rejected', 'retry'])('returns 409 when the status is %s', async (status) => {
        applicant = fakeApplicant({ status });

        const response = await asAdmin(request(app).patch(`${BASE_URL}/${APPLICANT_ID}/decision`))
            .send({ decision: 'accept' });

        expect(response.status).toBe(409);
        expect(applicant.role).toBe('member');
        expect(applicant.save).not.toHaveBeenCalled();
    });

    it.each(['findById', 'save'])('returns 500 when %s fails', async (operation) => {
        if (operation === 'findById') failApplicantLookup();
        if (operation === 'save') applicant.save.mockRejectedValue(new Error('Database unavailable'));

        const response = await asAdmin(request(app).patch(`${BASE_URL}/${APPLICANT_ID}/decision`))
            .send({ decision: 'accept' });

        expect(response.status).toBe(500);
    });
});
