import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../app.js";
import { env } from "../config/env.js";
import { LenderRequest } from "../models/LenderRequest.js";
import { User } from "../models/User.js";
import { getSignedDocumentUrl } from "../config/cloudinary.js";

// Mock the LenderRequest model with the two functions the admin controller uses: find and findById.
vi.mock('../models/LenderRequest.js', () => ({
    LenderRequest: {
        find: vi.fn(),
        findById: vi.fn()
    }
}));

// Mock the User model: accepting or rejecting also updates the applicant.
vi.mock('../models/User.js', () => ({
    User: { findById: vi.fn(), findByIdAndUpdate: vi.fn() }
}));

// Mock Cloudinary: tests never create real links and do not need the Cloudinary keys.
vi.mock('../config/cloudinary.js', () => ({
    getSignedDocumentUrl: vi.fn()
}));

const ADMIN_ID = 'admin1';
const REQUEST_ID = '64b0000000000000000000bb';
const APPLICANT_ID = 'sara123';
const BASE_URL = '/api/admin/lender-requests';
const USER_FIELDS = 'username profile';
const ORIGIN = 'http://localhost:3000';
const SIGNED_URL = 'https://res.cloudinary.com/demo/image/authenticated/s--signature--/v1/lender-documents/sara-id.png';

const sampleRequest = {
    _id: REQUEST_ID,
    status: 'pending',
    user: { username: 'sara123', profile: { name: 'Sara', email: 'sara@example.com' } },
    idDocument: { originalName: 'passport.png', storedName: 'lender-documents/sara-id', docType: 'image/png', size: 8 },
    proofOfAddress: { originalName: 'proof.pdf', storedName: 'lender-documents/sara-proof', docType: 'application/pdf', size: 8 }
};

function loginCookie(role) {
    User.findById.mockResolvedValue({ _id: ADMIN_ID, role, suspended: false });
    return `accessToken=${jwt.sign({ id: ADMIN_ID, role }, env.jwtSecret, { expiresIn: '15m' })}`;
}

// Sends the request as a logged-in admin from the trusted origin.
function asAdmin(req) {
    return req.set('Cookie', loginCookie('admin')).set('Origin', ORIGIN);
}

beforeEach(() => {
    vi.resetAllMocks();

    LenderRequest.find.mockReturnValue({ populate: vi.fn().mockReturnValue({ sort: vi.fn().mockResolvedValue([sampleRequest]) }) });
    LenderRequest.findById.mockReturnValue({ populate: vi.fn().mockResolvedValue(sampleRequest) });
    User.findByIdAndUpdate.mockResolvedValue({});
    getSignedDocumentUrl.mockReturnValue(SIGNED_URL);
});

const protectedUrls = [
    `${BASE_URL}`,
    `${BASE_URL}/${REQUEST_ID}`,
    `${BASE_URL}/${REQUEST_ID}/documents/idDocument`
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
        expect(LenderRequest.find).not.toHaveBeenCalled();
        expect(LenderRequest.findById).not.toHaveBeenCalled();
    });
});

describe('GET /api/admin/lender-requests', () => {
    it('returns 200 with the pending requests by default', async () => {
        const response = await asAdmin(request(app).get(BASE_URL));

        expect(response.status).toBe(200);
        expect(response.body).toHaveLength(1);
        expect(response.body[0].user.profile.name).toBe('Sara');
        expect(LenderRequest.find).toHaveBeenCalledWith({ status: 'pending' });

        const populate = LenderRequest.find.mock.results[0].value.populate;
        expect(populate).toHaveBeenCalledWith('user', USER_FIELDS);
        expect(populate.mock.results[0].value.sort).toHaveBeenCalledWith({ createdAt: -1 });
    });

    it.each(['approved', 'rejected'])('returns 200 and filters by status %s', async (status) => {
        const response = await asAdmin(request(app).get(`${BASE_URL}?status=${status}`));

        expect(response.status).toBe(200);
        expect(LenderRequest.find).toHaveBeenCalledWith({ status });
    });

    it.each(['draft', 'banana'])('returns 400 for status %s', async (status) => {
        const response = await asAdmin(request(app).get(`${BASE_URL}?status=${status}`));

        expect(response.status).toBe(400);
        expect(LenderRequest.find).not.toHaveBeenCalled();
    });

    it('returns 500 when the lookup fails', async () => {
        LenderRequest.find.mockImplementation(() => { throw new Error('Database unavailable'); });

        const response = await asAdmin(request(app).get(BASE_URL));

        expect(response.status).toBe(500);
    });
});

describe('GET /api/admin/lender-requests/:id', () => {
    it('returns 200 with the request, its documents and the user details', async () => {
        const response = await asAdmin(request(app).get(`${BASE_URL}/${REQUEST_ID}`));

        expect(response.status).toBe(200);
        expect(response.body.user.profile.name).toBe('Sara');
        expect(response.body.idDocument.originalName).toBe('passport.png');
        expect(response.body.proofOfAddress.originalName).toBe('proof.pdf');
        expect(LenderRequest.findById).toHaveBeenCalledWith(REQUEST_ID);
        expect(LenderRequest.findById.mock.results[0].value.populate).toHaveBeenCalledWith('user', USER_FIELDS);
    });

    it('returns 400 for an invalid id', async () => {
        const response = await asAdmin(request(app).get(`${BASE_URL}/not-an-id`));

        expect(response.status).toBe(400);
        expect(LenderRequest.findById).not.toHaveBeenCalled();
    });

    it('returns 404 when the request does not exist', async () => {
        LenderRequest.findById.mockReturnValue({ populate: vi.fn().mockResolvedValue(null) });

        const response = await asAdmin(request(app).get(`${BASE_URL}/${REQUEST_ID}`));

        expect(response.status).toBe(404);
    });

    it('returns 500 when the lookup fails', async () => {
        LenderRequest.findById.mockReturnValue({ populate: vi.fn().mockRejectedValue(new Error('Database unavailable')) });

        const response = await asAdmin(request(app).get(`${BASE_URL}/${REQUEST_ID}`));

        expect(response.status).toBe(500);
    });
});

describe('GET /api/admin/lender-requests/:id/documents/:slot', () => {
    beforeEach(() => {
        LenderRequest.findById.mockResolvedValue(sampleRequest);
    });

    it.each(['idDocument', 'proofOfAddress'])('redirects to a signed Cloudinary link to preview the %s', async (slot) => {
        const response = await asAdmin(request(app).get(`${BASE_URL}/${REQUEST_ID}/documents/${slot}`));

        expect(response.status).toBe(302);
        expect(response.headers.location).toBe(SIGNED_URL);
        expect(getSignedDocumentUrl).toHaveBeenCalledWith(sampleRequest[slot], false);
    });

    it('redirects to a download link with ?download=true', async () => {
        const response = await asAdmin(request(app).get(`${BASE_URL}/${REQUEST_ID}/documents/proofOfAddress?download=true`));

        expect(response.status).toBe(302);
        expect(getSignedDocumentUrl).toHaveBeenCalledWith(sampleRequest.proofOfAddress, true);
    });

    it('returns 400 for an invalid slot', async () => {
        const response = await asAdmin(request(app).get(`${BASE_URL}/${REQUEST_ID}/documents/banana`));

        expect(response.status).toBe(400);
        expect(LenderRequest.findById).not.toHaveBeenCalled();
    });

    it('returns 400 for an invalid id', async () => {
        const response = await asAdmin(request(app).get(`${BASE_URL}/not-an-id/documents/idDocument`));

        expect(response.status).toBe(400);
    });

    it('returns 404 when the request does not exist', async () => {
        LenderRequest.findById.mockResolvedValue(null);

        const response = await asAdmin(request(app).get(`${BASE_URL}/${REQUEST_ID}/documents/idDocument`));

        expect(response.status).toBe(404);
    });

    it('returns 404 when the slot is empty', async () => {
        LenderRequest.findById.mockResolvedValue({ ...sampleRequest, idDocument: undefined });

        const response = await asAdmin(request(app).get(`${BASE_URL}/${REQUEST_ID}/documents/idDocument`));

        expect(response.status).toBe(404);
        expect(response.body.message).toBe('Document not found');
        expect(getSignedDocumentUrl).not.toHaveBeenCalled();
    });

    it('returns 500 when the lookup fails', async () => {
        LenderRequest.findById.mockRejectedValue(new Error('Database unavailable'));

        const response = await asAdmin(request(app).get(`${BASE_URL}/${REQUEST_ID}/documents/idDocument`));

        expect(response.status).toBe(500);
    });
});

// A submitted request the way findById returns it for a decision (user is the applicant's id, not populated).
function pendingRequest(fields = {}) {
    return { _id: REQUEST_ID, status: 'pending', user: APPLICANT_ID, save: vi.fn().mockResolvedValue(), ...fields };
}

const invalidDecisions = [
    {},
    { decision: 'maybe' },
    { decision: 'reject' },
    { decision: 'reject', reason: '   ' },
    { decision: 'accept', reason: 'Looks good' }
];

describe('PATCH /api/admin/lender-requests/:id/decision', () => {
    it('returns 200, approves the request and makes the user a verified lender', async () => {
        const pending = pendingRequest();
        LenderRequest.findById.mockResolvedValue(pending);

        const response = await asAdmin(request(app).patch(`${BASE_URL}/${REQUEST_ID}/decision`))
            .send({ decision: 'accept' });

        expect(response.status).toBe(200);
        expect(response.body.status).toBe('approved');
        expect(pending.status).toBe('approved');
        expect(pending.rejectionReason).toBeUndefined();
        expect(pending.reviewedBy).toBe(ADMIN_ID);
        expect(pending.reviewedAt).toBeInstanceOf(Date);
        expect(pending.save).toHaveBeenCalledOnce();
        expect(User.findByIdAndUpdate).toHaveBeenCalledWith(APPLICANT_ID, { role: 'lender', 'verification.status': 'accepted' });
    });

    it('returns 200, rejects the request and stores the reason for the user', async () => {
        const pending = pendingRequest();
        LenderRequest.findById.mockResolvedValue(pending);

        const response = await asAdmin(request(app).patch(`${BASE_URL}/${REQUEST_ID}/decision`))
            .send({ decision: 'reject', reason: '  The ID document is blurry  ' });

        expect(response.status).toBe(200);
        expect(response.body.status).toBe('rejected');
        expect(pending.rejectionReason).toBe('The ID document is blurry');
        expect(pending.reviewedBy).toBe(ADMIN_ID);
        expect(pending.save).toHaveBeenCalledOnce();
        expect(User.findByIdAndUpdate).toHaveBeenCalledWith(APPLICANT_ID, { 'verification.status': 'rejected', 'verification.note': 'The ID document is blurry' });
    });

    it('returns 401 when not logged in', async () => {
        const response = await request(app)
            .patch(`${BASE_URL}/${REQUEST_ID}/decision`).set('Origin', ORIGIN)
            .send({ decision: 'accept' });

        expect(response.status).toBe(401);
    });

    it('returns 403 when the user is not an admin', async () => {
        const response = await request(app)
            .patch(`${BASE_URL}/${REQUEST_ID}/decision`).set('Origin', ORIGIN)
            .set('Cookie', loginCookie('member'))
            .send({ decision: 'accept' });

        expect(response.status).toBe(403);
        expect(LenderRequest.findById).not.toHaveBeenCalled();
    });

    it('returns 400 for an invalid id', async () => {
        const response = await asAdmin(request(app).patch(`${BASE_URL}/not-an-id/decision`))
            .send({ decision: 'accept' });

        expect(response.status).toBe(400);
        expect(LenderRequest.findById).not.toHaveBeenCalled();
    });

    it.each(invalidDecisions)('returns 400 for an invalid body %#', async (body) => {
        const response = await asAdmin(request(app).patch(`${BASE_URL}/${REQUEST_ID}/decision`))
            .send(body);

        expect(response.status).toBe(400);
        expect(LenderRequest.findById).not.toHaveBeenCalled();
        expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('returns 404 when the request does not exist', async () => {
        LenderRequest.findById.mockResolvedValue(null);

        const response = await asAdmin(request(app).patch(`${BASE_URL}/${REQUEST_ID}/decision`))
            .send({ decision: 'accept' });

        expect(response.status).toBe(404);
        expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it.each(['draft', 'approved', 'rejected'])('returns 409 when the request is %s', async (status) => {
        const reviewed = pendingRequest({ status });
        LenderRequest.findById.mockResolvedValue(reviewed);

        const response = await asAdmin(request(app).patch(`${BASE_URL}/${REQUEST_ID}/decision`))
            .send({ decision: 'accept' });

        expect(response.status).toBe(409);
        expect(reviewed.save).not.toHaveBeenCalled();
        expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it.each(['findById', 'save', 'findByIdAndUpdate'])('returns 500 when %s fails', async (operation) => {
        const pending = pendingRequest();
        LenderRequest.findById.mockResolvedValue(pending);
        if (operation === 'findById') LenderRequest.findById.mockRejectedValue(new Error('Database unavailable'));
        if (operation === 'save') pending.save.mockRejectedValue(new Error('Database unavailable'));
        if (operation === 'findByIdAndUpdate') User.findByIdAndUpdate.mockRejectedValue(new Error('Database unavailable'));

        const response = await asAdmin(request(app).patch(`${BASE_URL}/${REQUEST_ID}/decision`))
            .send({ decision: 'accept' });

        expect(response.status).toBe(500);
    });
});
