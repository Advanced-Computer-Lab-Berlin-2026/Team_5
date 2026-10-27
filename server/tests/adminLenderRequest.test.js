import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";
import app from "../app.js";
import { env } from "../config/env.js";
import { LenderRequest } from "../models/LenderRequest.js";
import { User } from "../models/User.js";
import { UPLOAD_DIR } from "../middleware/uploadLenderDocument.js";

// Mock the LenderRequest model with the two functions the admin controller uses: find and findById.
vi.mock('../models/LenderRequest.js', () => ({
    LenderRequest: {
        find: vi.fn(),
        findById: vi.fn()
    }
}));

// Mock the User model: accepting or rejecting also updates the applicant.
vi.mock('../models/User.js', () => ({
    User: { findByIdAndUpdate: vi.fn() }
}));

const ADMIN_ID = 'admin1';
const REQUEST_ID = '64b0000000000000000000bb';
const APPLICANT_ID = 'sara123';
const BASE_URL = '/api/admin/lender-requests';
const USER_FIELDS = 'username profile';
const ORIGIN = 'http://localhost:3000';

const sampleRequest = {
    _id: REQUEST_ID,
    status: 'pending',
    user: { username: 'sara123', profile: { name: 'Sara', email: 'sara@example.com' } },
    idDocument: { originalName: 'passport.png', storedName: 'admin-test-id.png', docType: 'image/png', size: 8 },
    proofOfAddress: { originalName: 'proof.pdf', storedName: 'admin-test-proof.pdf', docType: 'application/pdf', size: 8 }
};

// Logs in the way the auth middleware expects: a signed accessToken cookie with the user's id and role.
function loginCookie(role) {
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
});

afterEach(() => {
    fs.rmSync(path.join(UPLOAD_DIR, 'admin-test-id.png'), { force: true });
    fs.rmSync(path.join(UPLOAD_DIR, 'admin-test-proof.pdf'), { force: true });
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
        fs.writeFileSync(path.join(UPLOAD_DIR, 'admin-test-id.png'), 'png data');
        fs.writeFileSync(path.join(UPLOAD_DIR, 'admin-test-proof.pdf'), 'pdf data');
    });

    it.each([
        { slot: 'idDocument', type: 'image/png', content: 'png data' },
        { slot: 'proofOfAddress', type: 'application/pdf', content: 'pdf data' }
    ])('returns 200 with the $slot file for preview', async ({ slot, type, content }) => {
        const response = await asAdmin(request(app).get(`${BASE_URL}/${REQUEST_ID}/documents/${slot}`))
            .buffer(true)
            .parse((res, done) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => done(null, data));
            });

        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toContain(type);
        expect(response.headers['content-disposition']).toBeUndefined();
        expect(response.body).toBe(content);
    });

    it('returns 200 as a download with the original file name', async () => {
        const response = await asAdmin(request(app).get(`${BASE_URL}/${REQUEST_ID}/documents/proofOfAddress?download=true`));

        expect(response.status).toBe(200);
        expect(response.headers['content-disposition']).toContain('attachment');
        expect(response.headers['content-disposition']).toContain('proof.pdf');
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
    });

    it('returns 404 when the file is missing on disk', async () => {
        fs.rmSync(path.join(UPLOAD_DIR, 'admin-test-id.png'));

        const response = await asAdmin(request(app).get(`${BASE_URL}/${REQUEST_ID}/documents/idDocument`));

        expect(response.status).toBe(404);
        expect(response.body.message).toBe('Document file is missing');
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
