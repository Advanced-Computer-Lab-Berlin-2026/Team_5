import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import app from '../app.js';
import { User } from '../models/User.js';
import { PasswordReset } from '../models/PasswordReset.js';

vi.mock('../models/User.js', () => ({ User: { findOne: vi.fn() } }));
vi.mock('../models/PasswordReset.js', () => ({
    PasswordReset: { findOneAndUpdate: vi.fn(), updateOne: vi.fn() }
}));
const body = { email: 'martin@example.com', otp: '004281' };
const codeHash = await bcrypt.hash(body.otp, 10);
const send = data => request(app).post('/api/auth/verify-reset-otp').send(data);

beforeEach(() => {
    vi.resetAllMocks();
    User.findOne.mockResolvedValue({ _id: 'user123' });
    PasswordReset.findOneAndUpdate.mockResolvedValue({ _id: 'reset123', codeHash });
    PasswordReset.updateOne.mockResolvedValue({ modifiedCount: 1 });
});

describe('POST /api/auth/verify-reset-otp', () => {
    it('exchanges a valid OTP for a hashed, five-minute reset credential', async () => {
        const response = await send(body);
        expect(response.status).toBe(200);
        expect(response.body.resetToken).toMatch(/^[a-f0-9]{64}$/);
        expect(response.body.expiresIn).toBe(300);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(PasswordReset.findOneAndUpdate).toHaveBeenCalledWith({
            userId: 'user123', expiresAt: { $gt: expect.any(Date) },
            attempts: { $lt: 5 }, resetTokenHash: { $exists: false }
        }, { $inc: { attempts: 1 } }, { new: true });
        const [filter, update] = PasswordReset.updateOne.mock.calls[0];
        expect(filter.resetTokenHash).toEqual({ $exists: false });
        expect(update.$set.resetTokenHash).toBe(crypto.createHash('sha256')
            .update(response.body.resetToken).digest('hex'));
        expect(update.$set.expiresAt.getTime()).toBeGreaterThan(Date.now() + 290000);
    });

    it.each([{}, { ...body, otp: '123' }, { ...body, otp: 4281 }])('rejects invalid input %#', async data => {
        expect((await send(data)).status).toBe(400);
        expect(User.findOne).not.toHaveBeenCalled();
    });

    it.each(['user', 'session', 'wrong-code', 'consumed'])('rejects %s without a reset token', async scenario => {
        if (scenario === 'user') User.findOne.mockResolvedValue(null);
        if (scenario === 'session') PasswordReset.findOneAndUpdate.mockResolvedValue(null);
        if (scenario === 'consumed') PasswordReset.updateOne.mockResolvedValue({ modifiedCount: 0 });
        const response = await send(scenario === 'wrong-code' ? { ...body, otp: '111111' } : body);
        expect(response.status).toBe(401);
        expect(response.body).not.toHaveProperty('resetToken');
        if (scenario !== 'consumed') expect(PasswordReset.updateOne).not.toHaveBeenCalled();
    });

    it('forwards database failures', async () => {
        PasswordReset.findOneAndUpdate.mockRejectedValue(new Error('Database unavailable'));
        expect((await send(body)).status).toBe(500);
    });
});
