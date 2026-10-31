import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import app from '../app.js';
import { User } from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';

vi.mock('../models/User.js', () => ({
    User: {
        findById: vi.fn(),
        updateOne: vi.fn(),
        findByIdAndUpdate: vi.fn()
    }
}));

vi.mock('../middleware/auth.js', async (importOriginal) => ({
    ...(await importOriginal()),
    requireAuth: vi.fn()
}));

const TRUSTED_ORIGIN = 'http://localhost:3000';

function authenticateAs(id = 'member123', role = 'member') {
    requireAuth.mockImplementation((req, res, next) => {
        req.user = { id, role };
        next();
    });
}

function rejectAuth() {
    requireAuth.mockImplementation((req, res) =>
        res.status(401).json({ message: 'Authentication required' })
    );
}

function mockProfileUpdateQuery(result) {
    const select = vi.fn().mockResolvedValue(result);
    User.findByIdAndUpdate.mockReturnValue({ select });
    return select;
}

beforeEach(() => {
    vi.resetAllMocks();
    authenticateAs();
});

describe('PATCH /api/auth/change-password', () => {
    const validPayload = {
        currentPassword: 'oldPassword123',
        newPassword: 'NewPassword123'
    };

    const sendChangePassword = (body = validPayload) =>
        request(app)
            .patch('/api/auth/change-password')
            .set('Origin', TRUSTED_ORIGIN)
            .send(body);

    it.each(['member', 'lender', 'admin'])(
        'returns 200 and updates the password hash for a logged-in %s',
        async (role) => {
            authenticateAs('user123', role);
            const oldHash = await bcrypt.hash(validPayload.currentPassword, 10);
            User.findById.mockResolvedValue({ _id: 'user123', password: oldHash });
            User.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });

            const response = await sendChangePassword();

            expect(response.status).toBe(200);
            expect(response.body).toEqual({ message: 'Password changed successfully' });
            expect(User.findById).toHaveBeenCalledExactlyOnceWith('user123');
            expect(User.updateOne).toHaveBeenCalledOnce();

            const [filter, update, options] = User.updateOne.mock.calls[0];
            expect(filter).toEqual({ _id: 'user123' });
            expect(options).toEqual({ runValidators: true });
            expect(await bcrypt.compare(validPayload.newPassword, update.$set.password)).toBe(true);
        }
    );

    it('returns 401 when the request is not authenticated', async () => {
        rejectAuth();

        const response = await sendChangePassword();

        expect(response.status).toBe(401);
        expect(User.findById).not.toHaveBeenCalled();
        expect(User.updateOne).not.toHaveBeenCalled();
    });

    it.each([
        {},
        { currentPassword: 'oldPassword123' },
        { newPassword: 'NewPassword123' },
        { currentPassword: 'old', newPassword: 'short' },
        { currentPassword: 'old', newPassword: 'alllowercase123' }, // missing uppercase
        { currentPassword: 'old', newPassword: 'ALLUPPERCASE123' }, // missing lowercase
        { currentPassword: 'old', newPassword: 'NoNumbersHere' },   // missing number
        { currentPassword: 'old', newPassword: 'A1a' + 'x'.repeat(38) }, // > 40 chars
        { currentPassword: 'SamePassword1', newPassword: 'SamePassword1' } // same password
    ])('returns 400 for invalid password payload %#', async (invalidBody) => {
        const response = await sendChangePassword(invalidBody);

        expect(response.status).toBe(400);
        expect(User.findById).not.toHaveBeenCalled();
        expect(User.updateOne).not.toHaveBeenCalled();
    });

    it('returns 401 when the user no longer exists', async () => {
        User.findById.mockResolvedValue(null);

        const response = await sendChangePassword();

        expect(response.status).toBe(401);
        expect(response.body).toEqual({ message: 'User not found' });
        expect(User.updateOne).not.toHaveBeenCalled();
    });

    it('returns 401 when currentPassword does not match', async () => {
        const oldHash = await bcrypt.hash('differentPassword123', 10);
        User.findById.mockResolvedValue({ _id: 'member123', password: oldHash });

        const response = await sendChangePassword();

        expect(response.status).toBe(401);
        expect(response.body).toEqual({ message: 'Current password is incorrect' });
        expect(User.updateOne).not.toHaveBeenCalled();
    });

    it.each(['findById', 'updateOne'])(
        'returns 500 when %s fails',
        async (operation) => {
            const oldHash = await bcrypt.hash(validPayload.currentPassword, 10);
            User.findById.mockResolvedValue({ _id: 'member123', password: oldHash });
            User[operation].mockRejectedValue(new Error('Database unavailable'));

            const response = await sendChangePassword();

            expect(response.status).toBe(500);
        }
    );
});

describe('PATCH /api/profile', () => {
    const updatedProfile = {
        name: 'Martin',
        email: 'martin@example.com',
        phone: '+4915123456789',
        address: 'Alexanderplatz 1, Berlin'
    };

    const sendUpdateProfile = (body) =>
        request(app)
            .patch('/api/profile')
            .set('Origin', TRUSTED_ORIGIN)
            .send(body);

    it('returns 200 and updates both phoneNumber and homeAddress', async () => {
        const select = mockProfileUpdateQuery({ profile: updatedProfile });

        const response = await sendUpdateProfile({
            phoneNumber: '+4915123456789',
            homeAddress: 'Alexanderplatz 1, Berlin'
        });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            message: 'Profile updated successfully',
            profile: updatedProfile
        });
        expect(User.findByIdAndUpdate).toHaveBeenCalledExactlyOnceWith(
            'member123',
            {
                $set: {
                    'profile.phone': '+4915123456789',
                    'profile.address': 'Alexanderplatz 1, Berlin'
                }
            },
            { new: true, runValidators: true }
        );
        expect(select).toHaveBeenCalledExactlyOnceWith('profile');
    });

    it('returns 200 when updating only phoneNumber', async () => {
        mockProfileUpdateQuery({ profile: updatedProfile });

        const response = await sendUpdateProfile({ phoneNumber: '+4915123456789' });

        expect(response.status).toBe(200);
        expect(User.findByIdAndUpdate).toHaveBeenCalledExactlyOnceWith(
            'member123',
            { $set: { 'profile.phone': '+4915123456789' } },
            { new: true, runValidators: true }
        );
    });

    it('returns 200 when updating only homeAddress', async () => {
        mockProfileUpdateQuery({ profile: updatedProfile });

        const response = await sendUpdateProfile({ homeAddress: 'Alexanderplatz 1, Berlin' });

        expect(response.status).toBe(200);
        expect(User.findByIdAndUpdate).toHaveBeenCalledExactlyOnceWith(
            'member123',
            { $set: { 'profile.address': 'Alexanderplatz 1, Berlin' } },
            { new: true, runValidators: true }
        );
    });

    it.each([
        {},
        { phoneNumber: 'invalid-phone' },
        { phoneNumber: '0123456789' }, // missing leading '+'
        { phoneNumber: 12345 },
        { homeAddress: 12345 },
        { homeAddress: 'x'.repeat(201) },
        { name: 'Hacker' } // disallowed field
    ])('returns 400 for invalid profile payload %#', async (invalidBody) => {
        const response = await sendUpdateProfile(invalidBody);

        expect(response.status).toBe(400);
        expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('returns 401 when the request is not authenticated', async () => {
        rejectAuth();

        const response = await sendUpdateProfile({ homeAddress: 'Berlin' });

        expect(response.status).toBe(401);
        expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('returns 403 when an admin attempts to update member profile details', async () => {
        authenticateAs('admin123', 'admin');

        const response = await sendUpdateProfile({ homeAddress: 'Berlin' });

        expect(response.status).toBe(403);
        expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('returns 401 when the user is not found in the database', async () => {
        mockProfileUpdateQuery(null);

        const response = await sendUpdateProfile({ homeAddress: 'Berlin' });

        expect(response.status).toBe(401);
        expect(response.body).toEqual({ message: 'User not found' });
    });

    it('returns 500 when the database update fails', async () => {
        const select = mockProfileUpdateQuery(null);
        select.mockRejectedValue(new Error('Database unavailable'));

        const response = await sendUpdateProfile({ homeAddress: 'Berlin' });

        expect(response.status).toBe(500);
    });
});