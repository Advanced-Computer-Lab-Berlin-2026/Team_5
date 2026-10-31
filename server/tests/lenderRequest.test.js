import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../app.js";
import { env } from "../config/env.js";
import { User } from "../models/User.js";
import { uploadToCloudinary, deleteFromCloudinary } from "../config/cloudinary.js";

// Mock the User model: the lender request is stored in the user's verification field.
vi.mock('../models/User.js', () => ({
    User: { findById: vi.fn() }
}));

// Mock Cloudinary: tests never upload real files and do not need the Cloudinary keys.
vi.mock('../config/cloudinary.js', () => ({
    uploadToCloudinary: vi.fn(),
    deleteFromCloudinary: vi.fn()
}));

const USER_ID = 'sara123';
const BASE_URL = '/api/lender-requests';
const ORIGIN = 'http://localhost:3000';
const NEW_FILE_ID = 'lender-documents/new-file';
const NEW_FILE_URL = 'https://res.cloudinary.com/demo/image/authenticated/v1/lender-documents/new-file.pdf';

// The logged-in user. The auth middleware and the controller both load it with findById.
let user;

// Builds a fake user the way Mongoose would return it.
function fakeUser(role = 'member', verification = {}) {
    return {
        _id: USER_ID,
        role,
        suspended: false,
        verification: { status: 'none', documents: [], ...verification },
        save: vi.fn().mockResolvedValue()
    };
}

// A document that is already stored in Cloudinary under the given id.
function storedFile(type, storedName) {
    return { type, file: { url: `https://res.cloudinary.com/demo/${storedName}` }, originalName: 'old.pdf', storedName, docType: 'application/pdf', size: 8 };
}

// Logs in the way the auth middleware expects: a signed accessToken cookie, and the user it then loads from the database.
function loginCookie() {
    User.findById.mockResolvedValue(user);
    return `accessToken=${jwt.sign({ id: USER_ID, role: user.role }, env.jwtSecret, { expiresIn: '15m' })}`;
}

// The auth middleware still finds the user, but the controller's own lookup fails.
function failControllerLookup() {
    User.findById.mockResolvedValueOnce(user).mockRejectedValueOnce(new Error('Database unavailable'));
}

function findDocument(slot) {
    return user.verification.documents.find((document) => document.type === slot);
}

beforeEach(() => {
    vi.resetAllMocks();

    user = fakeUser();
    uploadToCloudinary.mockResolvedValue({ public_id: NEW_FILE_ID, secure_url: NEW_FILE_URL });
    deleteFromCloudinary.mockResolvedValue({ result: 'ok' });
});

describe('GET /api/lender-requests', () => {
    it('returns 401 when not logged in', async () => {
        const response = await request(app).get(BASE_URL);

        expect(response.status).toBe(401);
        expect(User.findById).not.toHaveBeenCalled();
    });

    it('returns 200 with the verification of the user', async () => {
        user = fakeUser('member', { status: 'pending', documents: [storedFile('id', 'lender-documents/sara-id')] });

        const response = await request(app)
            .get(BASE_URL)
            .set('Cookie', loginCookie());

        expect(response.status).toBe(200);
        expect(response.body.status).toBe('pending');
        expect(response.body.documents).toHaveLength(1);
        expect(User.findById).toHaveBeenCalledWith(USER_ID);
    });

    it('returns 200 with status none when the user has not applied', async () => {
        const response = await request(app)
            .get(BASE_URL)
            .set('Cookie', loginCookie());

        expect(response.status).toBe(200);
        expect(response.body.status).toBe('none');
        expect(response.body.documents).toEqual([]);
    });

    it('returns 500 when the lookup fails', async () => {
        const cookie = loginCookie();
        failControllerLookup();

        const response = await request(app)
            .get(BASE_URL)
            .set('Cookie', cookie);

        expect(response.status).toBe(500);
    });
});

const invalidFiles = [
    { name: 'notes.docx', content: Buffer.from('word file'), message: 'Only PDF, JPEG, JPG and PNG files are allowed' },
    { name: 'virus.exe', content: Buffer.from('program'), message: 'Only PDF, JPEG, JPG and PNG files are allowed' },
    { name: 'huge.pdf', content: Buffer.alloc(6 * 1024 * 1024), message: 'File is too large (max 5 MB)' }
];

describe('POST /api/lender-requests/documents/:slot', () => {
    it.each(['id', 'addressProof'])(
        'returns 200 and adds the %s document on the first upload',
        async (slot) => {
        const response = await request(app)
            .post(`${BASE_URL}/documents/${slot}`).set('Origin', ORIGIN)
            .set('Cookie', loginCookie())
            .attach('file', Buffer.from('fake pdf'), 'passport.pdf');

        expect(response.status).toBe(200);
        expect(response.body.documents).toHaveLength(1);
        expect(uploadToCloudinary).toHaveBeenCalledWith(Buffer.from('fake pdf'));
        expect(user.save).toHaveBeenCalledOnce();
        expect(findDocument(slot)).toEqual({
            type: slot,
            file: { url: NEW_FILE_URL },
            originalName: 'passport.pdf',
            storedName: NEW_FILE_ID,
            docType: 'application/pdf',
            size: 8
        });
        expect(deleteFromCloudinary).not.toHaveBeenCalled();
    });

    it('returns 200, replaces the old file and keeps the other document', async () => {
        user = fakeUser('member', { documents: [storedFile('id', 'lender-documents/old-id'), storedFile('addressProof', 'lender-documents/old-proof')] });

        const response = await request(app)
            .post(`${BASE_URL}/documents/id`).set('Origin', ORIGIN)
            .set('Cookie', loginCookie())
            .attach('file', Buffer.from('new image'), 'new-id.png');

        expect(response.status).toBe(200);
        expect(user.verification.documents).toHaveLength(2);
        expect(findDocument('id').originalName).toBe('new-id.png');
        expect(findDocument('id').storedName).toBe(NEW_FILE_ID);
        expect(findDocument('id').docType).toBe('image/png');
        expect(findDocument('addressProof').storedName).toBe('lender-documents/old-proof');
        expect(deleteFromCloudinary).toHaveBeenCalledWith('lender-documents/old-id');
    });

    it.each(['rejected', 'retry'])('returns 200 when the status is %s, so the member can apply again', async (status) => {
        user = fakeUser('member', { status });

        const response = await request(app)
            .post(`${BASE_URL}/documents/id`).set('Origin', ORIGIN)
            .set('Cookie', loginCookie())
            .attach('file', Buffer.from('fake pdf'), 'passport.pdf');

        expect(response.status).toBe(200);
        expect(user.save).toHaveBeenCalledOnce();
    });

    it('still returns 200 when the old file cannot be deleted from Cloudinary', async () => {
        user = fakeUser('member', { documents: [storedFile('id', 'lender-documents/old-id')] });
        deleteFromCloudinary.mockRejectedValue(new Error('Cloudinary unavailable'));
        vi.spyOn(console, 'error').mockImplementation(() => {});

        const response = await request(app)
            .post(`${BASE_URL}/documents/id`).set('Origin', ORIGIN)
            .set('Cookie', loginCookie())
            .attach('file', Buffer.from('new image'), 'new-id.png');

        expect(response.status).toBe(200);
    });

    it('returns 401 when not logged in', async () => {
        const response = await request(app)
            .post(`${BASE_URL}/documents/id`).set('Origin', ORIGIN)
            .attach('file', Buffer.from('fake pdf'), 'passport.pdf');

        expect(response.status).toBe(401);
        expect(uploadToCloudinary).not.toHaveBeenCalled();
    });

    it('returns 400 when no file is sent', async () => {
        const response = await request(app)
            .post(`${BASE_URL}/documents/id`).set('Origin', ORIGIN)
            .set('Cookie', loginCookie());

        expect(response.status).toBe(400);
        expect(response.body.message).toBe('Please choose a file to upload');
        expect(user.save).not.toHaveBeenCalled();
    });

    it('returns 400 for an invalid slot and does not upload the file', async () => {
        const response = await request(app)
            .post(`${BASE_URL}/documents/banana`).set('Origin', ORIGIN)
            .set('Cookie', loginCookie())
            .attach('file', Buffer.from('fake pdf'), 'passport.pdf');

        expect(response.status).toBe(400);
        expect(response.body.message).toBe('Invalid document slot');
        expect(uploadToCloudinary).not.toHaveBeenCalled();
    });

    it.each(invalidFiles)(
        'returns 400 for an invalid file ($name)',
        async (file) => {
        const response = await request(app)
            .post(`${BASE_URL}/documents/id`).set('Origin', ORIGIN)
            .set('Cookie', loginCookie())
            .attach('file', file.content, file.name);

        expect(response.status).toBe(400);
        expect(response.body.message).toBe(file.message);
        expect(uploadToCloudinary).not.toHaveBeenCalled();
    });

    it.each(['pending', 'accepted'])('returns 409 when the status is %s', async (status) => {
        user = fakeUser('member', { status });

        const response = await request(app)
            .post(`${BASE_URL}/documents/id`).set('Origin', ORIGIN)
            .set('Cookie', loginCookie())
            .attach('file', Buffer.from('fake pdf'), 'passport.pdf');

        expect(response.status).toBe(409);
        expect(user.save).not.toHaveBeenCalled();
        expect(uploadToCloudinary).not.toHaveBeenCalled();
    });

    it('returns 500 when the upload to Cloudinary fails and saves nothing', async () => {
        uploadToCloudinary.mockRejectedValue(new Error('Cloudinary unavailable'));

        const response = await request(app)
            .post(`${BASE_URL}/documents/id`).set('Origin', ORIGIN)
            .set('Cookie', loginCookie())
            .attach('file', Buffer.from('fake pdf'), 'passport.pdf');

        expect(response.status).toBe(500);
        expect(user.save).not.toHaveBeenCalled();
        expect(deleteFromCloudinary).not.toHaveBeenCalled();
    });

    it('returns 500 when saving fails and removes the new file from Cloudinary', async () => {
        user.save.mockRejectedValue(new Error('Database unavailable'));

        const response = await request(app)
            .post(`${BASE_URL}/documents/id`).set('Origin', ORIGIN)
            .set('Cookie', loginCookie())
            .attach('file', Buffer.from('fake pdf'), 'passport.pdf');

        expect(response.status).toBe(500);
        expect(deleteFromCloudinary).toHaveBeenCalledWith(NEW_FILE_ID);
    });
});

describe('DELETE /api/lender-requests/documents/:slot', () => {
    it('returns 200, removes the document and deletes the file from Cloudinary', async () => {
        user = fakeUser('member', { documents: [storedFile('id', 'lender-documents/old-id'), storedFile('addressProof', 'lender-documents/old-proof')] });

        const response = await request(app)
            .delete(`${BASE_URL}/documents/addressProof`).set('Origin', ORIGIN)
            .set('Cookie', loginCookie());

        expect(response.status).toBe(200);
        expect(findDocument('addressProof')).toBeUndefined();
        expect(findDocument('id').storedName).toBe('lender-documents/old-id');
        expect(user.save).toHaveBeenCalledOnce();
        expect(deleteFromCloudinary).toHaveBeenCalledWith('lender-documents/old-proof');
    });

    it('returns 401 when not logged in', async () => {
        const response = await request(app).delete(`${BASE_URL}/documents/id`).set('Origin', ORIGIN);

        expect(response.status).toBe(401);
    });

    it('returns 400 for an invalid slot', async () => {
        const response = await request(app)
            .delete(`${BASE_URL}/documents/banana`).set('Origin', ORIGIN)
            .set('Cookie', loginCookie());

        expect(response.status).toBe(400);
        expect(user.save).not.toHaveBeenCalled();
    });

    it('returns 404 when there is no document to remove', async () => {
        user = fakeUser('member', { documents: [storedFile('addressProof', 'lender-documents/old-proof')] });

        const response = await request(app)
            .delete(`${BASE_URL}/documents/id`).set('Origin', ORIGIN)
            .set('Cookie', loginCookie());

        expect(response.status).toBe(404);
        expect(user.save).not.toHaveBeenCalled();
    });

    it('returns 409 when the request was already submitted', async () => {
        user = fakeUser('member', { status: 'pending', documents: [storedFile('id', 'lender-documents/locked-id')] });

        const response = await request(app)
            .delete(`${BASE_URL}/documents/id`).set('Origin', ORIGIN)
            .set('Cookie', loginCookie());

        expect(response.status).toBe(409);
        expect(user.save).not.toHaveBeenCalled();
        expect(deleteFromCloudinary).not.toHaveBeenCalled();
    });

    it('returns 500 when the lookup fails', async () => {
        const cookie = loginCookie();
        failControllerLookup();

        const response = await request(app)
            .delete(`${BASE_URL}/documents/id`).set('Origin', ORIGIN)
            .set('Cookie', cookie);

        expect(response.status).toBe(500);
    });
});

const bothDocuments = [storedFile('id', 'lender-documents/sara-id'), storedFile('addressProof', 'lender-documents/sara-proof')];

const incompleteRequests = [
    { documents: [storedFile('id', 'lender-documents/sara-id')], message: 'Please upload your proof of address' },
    { documents: [storedFile('addressProof', 'lender-documents/sara-proof')], message: 'Please upload your ID document' },
    { documents: [], message: 'Please upload your ID document and proof of address' }
];

describe('POST /api/lender-requests/submit', () => {
    it('returns 200 and changes the status to pending when both documents are uploaded', async () => {
        user = fakeUser('member', { documents: bothDocuments });

        const response = await request(app)
            .post(`${BASE_URL}/submit`).set('Origin', ORIGIN)
            .set('Cookie', loginCookie());

        expect(response.status).toBe(200);
        expect(response.body.status).toBe('pending');
        expect(user.verification.status).toBe('pending');
        expect(user.verification.submittedAt).toBeInstanceOf(Date);
        expect(user.save).toHaveBeenCalledOnce();
    });

    it('returns 200 and clears the earlier review when a rejected member submits again', async () => {
        user = fakeUser('member', {
            status: 'rejected',
            note: 'The ID document is blurry',
            reviewedBy: 'admin1',
            reviewedAt: new Date(),
            documents: bothDocuments
        });

        const response = await request(app)
            .post(`${BASE_URL}/submit`).set('Origin', ORIGIN)
            .set('Cookie', loginCookie());

        expect(response.status).toBe(200);
        expect(user.verification.status).toBe('pending');
        expect(user.verification.note).toBeUndefined();
        expect(user.verification.reviewedBy).toBeUndefined();
        expect(user.verification.reviewedAt).toBeUndefined();
    });

    it('returns 401 when not logged in', async () => {
        const response = await request(app).post(`${BASE_URL}/submit`).set('Origin', ORIGIN);

        expect(response.status).toBe(401);
        expect(User.findById).not.toHaveBeenCalled();
    });

    it.each(incompleteRequests)(
        'returns 400 with "$message"',
        async ({ documents, message }) => {
        user = fakeUser('member', { documents });

        const response = await request(app)
            .post(`${BASE_URL}/submit`).set('Origin', ORIGIN)
            .set('Cookie', loginCookie());

        expect(response.status).toBe(400);
        expect(response.body.message).toBe(message);
        expect(user.verification.status).toBe('none');
        expect(user.save).not.toHaveBeenCalled();
    });

    it.each(['pending', 'accepted'])('returns 409 when the status is %s', async (status) => {
        user = fakeUser('member', { status, documents: bothDocuments });

        const response = await request(app)
            .post(`${BASE_URL}/submit`).set('Origin', ORIGIN)
            .set('Cookie', loginCookie());

        expect(response.status).toBe(409);
        expect(user.save).not.toHaveBeenCalled();
    });

    it.each(['findById', 'save'])(
        'returns 500 when %s fails',
        async (operation) => {
        user = fakeUser('member', { documents: bothDocuments });
        const cookie = loginCookie();
        if (operation === 'findById') failControllerLookup();
        if (operation === 'save') user.save.mockRejectedValue(new Error('Database unavailable'));

        const response = await request(app)
            .post(`${BASE_URL}/submit`).set('Origin', ORIGIN)
            .set('Cookie', cookie);

        expect(response.status).toBe(500);
    });
});

const applyRequests = [
    { method: 'post', url: '/documents/id', withFile: true },
    { method: 'delete', url: '/documents/id', withFile: false },
    { method: 'post', url: '/submit', withFile: false }
];

describe('Only members can apply to become a lender', () => {
    describe.each([
        { role: 'lender', message: 'You are already a verified lender' },
        { role: 'admin', message: 'Admins cannot apply to become a lender' }
    ])('as $role', ({ role, message }) => {
        it.each(applyRequests)('returns 403 for $method $url', async ({ method, url, withFile }) => {
            user = fakeUser(role);
            let req = request(app)[method](`${BASE_URL}${url}`).set('Origin', ORIGIN)
                .set('Cookie', loginCookie());
            if (withFile) req = req.attach('file', Buffer.from('fake pdf'), 'passport.pdf');

            const response = await req;

            expect(response.status).toBe(403);
            expect(response.body.message).toBe(message);
            expect(user.save).not.toHaveBeenCalled();
            expect(uploadToCloudinary).not.toHaveBeenCalled();
        });
    });

    it('still lets a lender view their own request', async () => {
        user = fakeUser('lender', { status: 'accepted' });

        const response = await request(app)
            .get(BASE_URL)
            .set('Cookie', loginCookie());

        expect(response.status).toBe(200);
        expect(response.body.status).toBe('accepted');
    });
});
