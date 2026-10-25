import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import app from '../app.js';
import { User } from '../models/User.js';
import { PasswordReset } from '../models/PasswordReset.js';
import { RefreshSession } from '../models/RefreshSession.js';

vi.mock('../models/User.js', () => ({ User: { updateOne: vi.fn() } }));
vi.mock('../models/PasswordReset.js', () => ({ PasswordReset: { findOneAndDelete: vi.fn() } }));
vi.mock('../models/RefreshSession.js', () => ({ RefreshSession: { deleteMany: vi.fn() } }));
const body = { resetToken: 'a'.repeat(64), newPassword: 'new-secret123' };
const send = data => request(app).post('/api/auth/reset-password').send(data);

beforeEach(() => {
    vi.resetAllMocks();
    PasswordReset.findOneAndDelete.mockResolvedValue({ userId: 'user123' });
    User.updateOne.mockResolvedValue({ matchedCount: 1 });
    RefreshSession.deleteMany.mockResolvedValue({ deletedCount: 2 });
});

describe('POST /api/auth/reset-password', () => {
    it('hashes the password, consumes the reset token, and revokes refresh sessions', async () => {
        const response = await send(body);
        expect(response.status).toBe(200);
        expect(PasswordReset.findOneAndDelete).toHaveBeenCalledExactlyOnceWith({
            resetTokenHash: crypto.createHash('sha256').update(body.resetToken).digest('hex'),
            expiresAt: { $gt: expect.any(Date) }
        });
        const [filter, update, options] = User.updateOne.mock.calls[0];
        expect(filter).toEqual({ _id: 'user123' });
        expect(options).toEqual({ runValidators: true });
        expect(await bcrypt.compare(body.newPassword, update.$set.password)).toBe(true);
        expect(RefreshSession.deleteMany).toHaveBeenCalledExactlyOnceWith({ userId: 'user123' });
        expect(response.headers['set-cookie'][0]).toContain('refreshToken=;');
        expect(response.headers['set-cookie'][0]).toContain('Path=/api/auth');
        expect(response.body).not.toHaveProperty('accessToken');
        expect(response.headers['cache-control']).toBe('no-store');
    });

    it.each([{}, { ...body, resetToken: 'bad' }, { ...body, newPassword: 'short' },
        { ...body, newPassword: 'x'.repeat(41) }, { ...body, newPassword: 123456 }])(
        'rejects invalid input %#', async data => {
            expect((await send(data)).status).toBe(400);
            expect(PasswordReset.findOneAndDelete).not.toHaveBeenCalled();
            expect(User.updateOne).not.toHaveBeenCalled();
        }
    );

    it('rejects missing, expired, or consumed credentials without changing the password', async () => {
        PasswordReset.findOneAndDelete.mockResolvedValue(null);
        expect((await send(body)).status).toBe(401);
        expect(User.updateOne).not.toHaveBeenCalled();
        expect(RefreshSession.deleteMany).not.toHaveBeenCalled();
    });

    it('rejects a deleted user', async () => {
        User.updateOne.mockResolvedValue({ matchedCount: 0 });
        expect((await send(body)).status).toBe(401);
        expect(RefreshSession.deleteMany).not.toHaveBeenCalled();
    });

    it('rejects reuse after a successful reset', async () => {
        PasswordReset.findOneAndDelete.mockResolvedValueOnce({ userId: 'user123' }).mockResolvedValue(null);
        expect((await send(body)).status).toBe(200);
        expect((await send(body)).status).toBe(401);
        expect(User.updateOne).toHaveBeenCalledOnce();
    });

    it.each(['consume', 'update', 'revoke'])('forwards errors during %s', async stage => {
        const error = new Error('Database unavailable');
        if (stage === 'consume') PasswordReset.findOneAndDelete.mockRejectedValue(error);
        if (stage === 'update') User.updateOne.mockRejectedValue(error);
        if (stage === 'revoke') RefreshSession.deleteMany.mockRejectedValue(error);
        expect((await send(body)).status).toBe(500);
    });
});
