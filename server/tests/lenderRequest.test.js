import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../app.js";
import { env } from "../config/env.js";
import { LenderRequest } from "../models/LenderRequest.js";
import { User } from "../models/User.js";
import { isCloudinaryConfigured, uploadToCloudinary, deleteFromCloudinary } from "../config/cloudinary.js";

// Mock the LenderRequest model. 
vi.mock('../models/LenderRequest.js', () => ({
    LenderRequest: Object.assign(vi.fn(), { findOne: vi.fn() })
}));

// Mock the User model: submitting also marks the user's verification status as pending.
vi.mock('../models/User.js', () => ({
       User: { findById: vi.fn(), findByIdAndUpdate: vi.fn() }
}
));

// Mock Cloudinary: tests never upload real files and do not need the Cloudinary keys.
vi.mock('../config/cloudinary.js', () => ({
    isCloudinaryConfigured: vi.fn(),
    uploadToCloudinary: vi.fn(),
    deleteFromCloudinary: vi.fn()
}));

const USER_ID = 'sara123';
const BASE_URL = '/api/lender-requests';
const ORIGIN = 'http://localhost:3000';
const NEW_FILE_ID = 'lender-documents/new-file';

// Logs in the way the auth middleware expects: a signed accessToken cookie with the user's id and role.
// Logs in the way the auth middleware expects: a signed accessToken cookie, and the user it then loads from the database.
function loginCookie(role = 'member') {
    User.findById.mockResolvedValue({ _id: USER_ID, role, suspended: false });
    return `accessToken=${jwt.sign({ id: USER_ID, role }, env.jwtSecret, { expiresIn: '15m' })}`;
}


// Builds a fake request document the way Mongoose would return it.
function fakeRequest(fields = {}) {
    return { user: USER_ID, status: 'draft', save: vi.fn().mockResolvedValue(), ...fields };
}

// A document that is already stored in Cloudinary under the given id.
function storedFile(storedName) {
    return { originalName: 'old.pdf', storedName, docType: 'application/pdf', size: 8 };
}

beforeEach(() => {
    vi.resetAllMocks();

    LenderRequest.findOne.mockResolvedValue(null);
    User.findByIdAndUpdate.mockResolvedValue({});
    LenderRequest.mockImplementation(function (data) {
        return fakeRequest(data);
    });
    isCloudinaryConfigured.mockReturnValue(true);
    uploadToCloudinary.mockResolvedValue({ public_id: NEW_FILE_ID });
    deleteFromCloudinary.mockResolvedValue({ result: 'ok' });
});

describe('GET /api/lender-requests', () => {
    it('returns 401 when not logged in', async () => {
        const response = await request(app).get(BASE_URL);

        expect(response.status).toBe(401);
        expect(LenderRequest.findOne).not.toHaveBeenCalled();
    });

    it('returns 200 with the newest request of the user', async () => {
        const sort = vi.fn().mockResolvedValue({ user: USER_ID, status: 'draft' });
        LenderRequest.findOne.mockReturnValue({ sort });

        const response = await request(app)
            .get(BASE_URL)
            .set('Cookie', loginCookie());

        expect(response.status).toBe(200);
        expect(response.body.status).toBe('draft');
        expect(LenderRequest.findOne).toHaveBeenCalledWith({ user: USER_ID });
        expect(sort).toHaveBeenCalledWith({ createdAt: -1 });
    });

    it('returns 200 with null when the user has no request', async () => {
        LenderRequest.findOne.mockReturnValue({ sort: vi.fn().mockResolvedValue(null) });

        const response = await request(app)
            .get(BASE_URL)
            .set('Cookie', loginCookie());

        expect(response.status).toBe(200);
        expect(response.body).toBeNull();
    });

    it('returns 500 when the lookup fails', async () => {
        LenderRequest.findOne.mockReturnValue({ sort: vi.fn().mockRejectedValue(new Error('Database unavailable')) });

        const response = await request(app)
            .get(BASE_URL)
            .set('Cookie', loginCookie());

        expect(response.status).toBe(500);
    });
});

const invalidFiles = [
    { name: 'notes.docx', content: Buffer.from('word file'), message: 'Only PDF, JPEG, JPG and PNG files are allowed' },
    { name: 'virus.exe', content: Buffer.from('program'), message: 'Only PDF, JPEG, JPG and PNG files are allowed' },
    { name: 'huge.pdf', content: Buffer.alloc(6 * 1024 * 1024), message: 'File is too large (max 5 MB)' }
];

describe('POST /api/lender-requests/documents/:slot', () => {
    it.each(['idDocument', 'proofOfAddress'])(
        'returns 200 and creates a draft request when uploading %s for the first time',
        async (slot) => {
        const response = await request(app)
            .post(`${BASE_URL}/documents/${slot}`).set('Origin', ORIGIN)
            .set('Cookie', loginCookie())
            .attach('file', Buffer.from('fake pdf'), 'passport.pdf');

        expect(response.status).toBe(200);
        expect(LenderRequest).toHaveBeenCalledWith({ user: USER_ID });
        expect(uploadToCloudinary).toHaveBeenCalledWith(Buffer.from('fake pdf'));

        const savedRequest = LenderRequest.mock.results[0].value;
        expect(savedRequest.save).toHaveBeenCalledOnce();
        expect(savedRequest[slot].originalName).toBe('passport.pdf');
        expect(savedRequest[slot].storedName).toBe(NEW_FILE_ID);
        expect(savedRequest[slot].docType).toBe('application/pdf');
        expect(deleteFromCloudinary).not.toHaveBeenCalled();
    });

    it('returns 200 and replaces the old file in an existing draft', async () => {
        const existing = fakeRequest({ idDocument: storedFile('lender-documents/old-id') });
        LenderRequest.findOne.mockResolvedValue(existing);

        const response = await request(app)
            .post(`${BASE_URL}/documents/idDocument`).set('Origin', ORIGIN)
            .set('Cookie', loginCookie())
            .attach('file', Buffer.from('new image'), 'new-id.png');

        expect(response.status).toBe(200);
        expect(LenderRequest).not.toHaveBeenCalled();
        expect(existing.save).toHaveBeenCalledOnce();
        expect(existing.idDocument.originalName).toBe('new-id.png');
        expect(existing.idDocument.storedName).toBe(NEW_FILE_ID);
        expect(existing.idDocument.docType).toBe('image/png');
        expect(deleteFromCloudinary).toHaveBeenCalledWith('lender-documents/old-id');
    });

    it('still returns 200 when the old file cannot be deleted from Cloudinary', async () => {
        LenderRequest.findOne.mockResolvedValue(fakeRequest({ idDocument: storedFile('lender-documents/old-id') }));
        deleteFromCloudinary.mockRejectedValue(new Error('Cloudinary unavailable'));
        vi.spyOn(console, 'error').mockImplementation(() => {});

        const response = await request(app)
            .post(`${BASE_URL}/documents/idDocument`).set('Origin', ORIGIN)
            .set('Cookie', loginCookie())
            .attach('file', Buffer.from('new image'), 'new-id.png');

        expect(response.status).toBe(200);
    });

    it('returns 401 when not logged in', async () => {
        const response = await request(app)
            .post(`${BASE_URL}/documents/idDocument`).set('Origin', ORIGIN)
            .attach('file', Buffer.from('fake pdf'), 'passport.pdf');

        expect(response.status).toBe(401);
        expect(uploadToCloudinary).not.toHaveBeenCalled();
    });

    it('returns 400 when no file is sent', async () => {
        const response = await request(app)
            .post(`${BASE_URL}/documents/idDocument`).set('Origin', ORIGIN)
            .set('Cookie', loginCookie());

        expect(response.status).toBe(400);
        expect(response.body.message).toBe('Please choose a file to upload');
        expect(LenderRequest.findOne).not.toHaveBeenCalled();
    });

    it('returns 400 for an invalid slot and does not upload the file', async () => {
        const response = await request(app)
            .post(`${BASE_URL}/documents/banana`).set('Origin', ORIGIN)
            .set('Cookie', loginCookie())
            .attach('file', Buffer.from('fake pdf'), 'passport.pdf');

        expect(response.status).toBe(400);
        expect(response.body.message).toBe('Invalid document slot');
        expect(LenderRequest.findOne).not.toHaveBeenCalled();
        expect(uploadToCloudinary).not.toHaveBeenCalled();
    });

    it.each(invalidFiles)(
        'returns 400 for an invalid file ($name)',
        async (file) => {
        const response = await request(app)
            .post(`${BASE_URL}/documents/idDocument`).set('Origin', ORIGIN)
            .set('Cookie', loginCookie())
            .attach('file', file.content, file.name);

        expect(response.status).toBe(400);
        expect(response.body.message).toBe(file.message);
        expect(LenderRequest.findOne).not.toHaveBeenCalled();
        expect(uploadToCloudinary).not.toHaveBeenCalled();
    });

    it('returns 409 when the request was already submitted', async () => {
        const submitted = fakeRequest({ status: 'pending' });
        LenderRequest.findOne.mockResolvedValue(submitted);

        const response = await request(app)
            .post(`${BASE_URL}/documents/idDocument`).set('Origin', ORIGIN)
            .set('Cookie', loginCookie())
            .attach('file', Buffer.from('fake pdf'), 'passport.pdf');

        expect(response.status).toBe(409);
        expect(submitted.save).not.toHaveBeenCalled();
        expect(uploadToCloudinary).not.toHaveBeenCalled();
    });

    it('returns 503 when Cloudinary is not configured', async () => {
        isCloudinaryConfigured.mockReturnValue(false);

        const response = await request(app)
            .post(`${BASE_URL}/documents/idDocument`).set('Origin', ORIGIN)
            .set('Cookie', loginCookie())
            .attach('file', Buffer.from('fake pdf'), 'passport.pdf');

        expect(response.status).toBe(503);
        expect(response.body.message).toBe('File storage is not configured. Please try again later.');
        expect(uploadToCloudinary).not.toHaveBeenCalled();
    });

    it('returns 500 when the upload to Cloudinary fails and saves nothing', async () => {
        const existing = fakeRequest();
        LenderRequest.findOne.mockResolvedValue(existing);
        uploadToCloudinary.mockRejectedValue(new Error('Cloudinary unavailable'));

        const response = await request(app)
            .post(`${BASE_URL}/documents/idDocument`).set('Origin', ORIGIN)
            .set('Cookie', loginCookie())
            .attach('file', Buffer.from('fake pdf'), 'passport.pdf');

        expect(response.status).toBe(500);
        expect(existing.save).not.toHaveBeenCalled();
        expect(deleteFromCloudinary).not.toHaveBeenCalled();
    });

    it('returns 500 when saving fails and removes the new file from Cloudinary', async () => {
        const existing = fakeRequest();
        existing.save.mockRejectedValue(new Error('Database unavailable'));
        LenderRequest.findOne.mockResolvedValue(existing);

        const response = await request(app)
            .post(`${BASE_URL}/documents/idDocument`).set('Origin', ORIGIN)
            .set('Cookie', loginCookie())
            .attach('file', Buffer.from('fake pdf'), 'passport.pdf');

        expect(response.status).toBe(500);
        expect(deleteFromCloudinary).toHaveBeenCalledWith(NEW_FILE_ID);
    });
});

describe('DELETE /api/lender-requests/documents/:slot', () => {
    it('returns 200, empties the slot and deletes the file from Cloudinary', async () => {
        const existing = fakeRequest({ proofOfAddress: storedFile('lender-documents/old-addressproof') });
        LenderRequest.findOne.mockResolvedValue(existing);

        const response = await request(app)
            .delete(`${BASE_URL}/documents/proofOfAddress`).set('Origin', ORIGIN)
            .set('Cookie', loginCookie());

        expect(response.status).toBe(200);
        expect(existing.proofOfAddress).toBeUndefined();
        expect(existing.save).toHaveBeenCalledOnce();
        expect(deleteFromCloudinary).toHaveBeenCalledWith('lender-documents/old-addressproof');
    });

    it('returns 401 when not logged in', async () => {
        const response = await request(app).delete(`${BASE_URL}/documents/idDocument`).set('Origin', ORIGIN);

        expect(response.status).toBe(401);
    });

    it('returns 400 for an invalid slot', async () => {
        const response = await request(app)
            .delete(`${BASE_URL}/documents/banana`).set('Origin', ORIGIN)
            .set('Cookie', loginCookie());

        expect(response.status).toBe(400);
        expect(LenderRequest.findOne).not.toHaveBeenCalled();
    });

    it('returns 503 when Cloudinary is not configured', async () => {
        isCloudinaryConfigured.mockReturnValue(false);

        const response = await request(app)
            .delete(`${BASE_URL}/documents/idDocument`).set('Origin', ORIGIN)
            .set('Cookie', loginCookie());

        expect(response.status).toBe(503);
        expect(LenderRequest.findOne).not.toHaveBeenCalled();
    });

    it.each([null, fakeRequest()])(
        'returns 404 when there is no document to remove %#',
        async (existing) => {
        LenderRequest.findOne.mockResolvedValue(existing);

        const response = await request(app)
            .delete(`${BASE_URL}/documents/idDocument`).set('Origin', ORIGIN)
            .set('Cookie', loginCookie());

        expect(response.status).toBe(404);
    });

    it('returns 409 when the request was already submitted', async () => {
        const submitted = fakeRequest({ status: 'pending', idDocument: storedFile('lender-documents/locked-id') });
        LenderRequest.findOne.mockResolvedValue(submitted);

        const response = await request(app)
            .delete(`${BASE_URL}/documents/idDocument`).set('Origin', ORIGIN)
            .set('Cookie', loginCookie());

        expect(response.status).toBe(409);
        expect(submitted.save).not.toHaveBeenCalled();
        expect(deleteFromCloudinary).not.toHaveBeenCalled();
    });

    it('returns 500 when the lookup fails', async () => {
        LenderRequest.findOne.mockRejectedValue(new Error('Database unavailable'));

        const response = await request(app)
            .delete(`${BASE_URL}/documents/idDocument`).set('Origin', ORIGIN)
            .set('Cookie', loginCookie());

        expect(response.status).toBe(500);
    });
});

const incompleteRequests = [
    { documents: { idDocument: { originalName: 'id.pdf' } }, message: 'Please upload your proof of address' },
    { documents: { proofOfAddress: { originalName: 'addressproof.pdf' } }, message: 'Please upload your ID document' },
    { documents: {}, message: 'Please upload your ID document and proof of address' }
];

describe('POST /api/lender-requests/submit', () => {
    it('returns 200 and changes the status to pending when both documents are uploaded', async () => {
        const draft = fakeRequest({ idDocument: { originalName: 'id.pdf' }, proofOfAddress: { originalName: 'addressproof.pdf' } });
        LenderRequest.findOne.mockResolvedValue(draft);

        const response = await request(app)
            .post(`${BASE_URL}/submit`).set('Origin', ORIGIN)
            .set('Cookie', loginCookie());

        expect(response.status).toBe(200);
        expect(response.body.status).toBe('pending');
        expect(draft.status).toBe('pending');
        expect(draft.save).toHaveBeenCalledOnce();
        expect(LenderRequest.findOne).toHaveBeenCalledWith({ user: USER_ID, status: { $in: ['draft', 'pending'] } });
        expect(User.findByIdAndUpdate).toHaveBeenCalledWith(USER_ID, { 'verification.status': 'pending' });
    });

    it('returns 401 when not logged in', async () => {
        const response = await request(app).post(`${BASE_URL}/submit`).set('Origin', ORIGIN);

        expect(response.status).toBe(401);
        expect(LenderRequest.findOne).not.toHaveBeenCalled();
    });

    it('returns 404 when the member has no request', async () => {
        const response = await request(app)
            .post(`${BASE_URL}/submit`).set('Origin', ORIGIN)
            .set('Cookie', loginCookie());

        expect(response.status).toBe(404);
    });

    it.each(incompleteRequests)(
        'returns 400 with "$message"',
        async ({ documents, message }) => {
        const draft = fakeRequest(documents);
        LenderRequest.findOne.mockResolvedValue(draft);

        const response = await request(app)
            .post(`${BASE_URL}/submit`).set('Origin', ORIGIN)
            .set('Cookie', loginCookie());

        expect(response.status).toBe(400);
        expect(response.body.message).toBe(message);
        expect(draft.status).toBe('draft');
        expect(draft.save).not.toHaveBeenCalled();
        expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('returns 409 when the request was already submitted', async () => {
        const submitted = fakeRequest({ status: 'pending', idDocument: { originalName: 'id.pdf' }, proofOfAddress: { originalName: 'addressproof.pdf' } });
        LenderRequest.findOne.mockResolvedValue(submitted);

        const response = await request(app)
            .post(`${BASE_URL}/submit`).set('Origin', ORIGIN)
            .set('Cookie', loginCookie());

        expect(response.status).toBe(409);
        expect(submitted.save).not.toHaveBeenCalled();
        expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it.each(['findOne', 'save', 'findByIdAndUpdate'])(
        'returns 500 when %s fails',
        async (operation) => {
        const draft = fakeRequest({ idDocument: { originalName: 'id.pdf' }, proofOfAddress: { originalName: 'addressproof.pdf' } });
        LenderRequest.findOne.mockResolvedValue(draft);
        if (operation === 'findOne') LenderRequest.findOne.mockRejectedValue(new Error('Database unavailable'));
        if (operation === 'save') draft.save.mockRejectedValue(new Error('Database unavailable'));
        if (operation === 'findByIdAndUpdate') User.findByIdAndUpdate.mockRejectedValue(new Error('Database unavailable'));

        const response = await request(app)
            .post(`${BASE_URL}/submit`).set('Origin', ORIGIN)
            .set('Cookie', loginCookie());

        expect(response.status).toBe(500);
    });
});

const applyRequests = [
    { method: 'post', url: '/documents/idDocument', withFile: true },
    { method: 'delete', url: '/documents/idDocument', withFile: false },
    { method: 'post', url: '/submit', withFile: false }
];

describe('Only members can apply to become a lender', () => {
    describe.each([
        { role: 'lender', message: 'You are already a verified lender' },
        { role: 'admin', message: 'Admins cannot apply to become a lender' }
    ])('as $role', ({ role, message }) => {
        it.each(applyRequests)('returns 403 for $method $url', async ({ method, url, withFile }) => {
            let req = request(app)[method](`${BASE_URL}${url}`).set('Origin', ORIGIN)
                .set('Cookie', loginCookie(role));
            if (withFile) req = req.attach('file', Buffer.from('fake pdf'), 'passport.pdf');

            const response = await req;

            expect(response.status).toBe(403);
            expect(response.body.message).toBe(message);
            expect(LenderRequest.findOne).not.toHaveBeenCalled();
            expect(uploadToCloudinary).not.toHaveBeenCalled();
        });
    });

    it('still lets a lender view their own request', async () => {
        LenderRequest.findOne.mockReturnValue({ sort: vi.fn().mockResolvedValue({ user: USER_ID, status: 'approved' }) });

        const response = await request(app)
            .get(BASE_URL)
            .set('Cookie', loginCookie('lender'));

        expect(response.status).toBe(200);
        expect(response.body.status).toBe('approved');
    });
});
