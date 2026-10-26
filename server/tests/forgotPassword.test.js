import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import app from '../app.js';
import { User } from '../models/User.js';
import { PasswordReset } from '../models/PasswordReset.js';
import { sendResetEmail } from '../services/emailService.js';

vi.mock('../models/User.js', () => ({ User: { findOne: vi.fn() } }));
vi.mock('../models/PasswordReset.js', () => ({ PasswordReset: { findOneAndUpdate: vi.fn() } }));
vi.mock('../services/emailService.js', () => ({ sendResetEmail: vi.fn() }));
const message = 'If an account exists, a reset code has been sent.';
const send = body => request(app).post('/api/auth/forget-password').send(body);

beforeEach(() => {
    vi.resetAllMocks();
    User.findOne.mockResolvedValue({ _id: 'user123', profile: { email: 'martin@example.com' } });
    PasswordReset.findOneAndUpdate.mockResolvedValue({});
    sendResetEmail.mockResolvedValue(undefined);
});

describe('POST /api/auth/forget-password', () => {
    it('stores only the code hash and emails the original six-digit code', async () => {
        const startedAt = Date.now();
        const response = await send({ email: ' martin@example.com ' });
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ message });
        expect(User.findOne).toHaveBeenCalledWith({ 'profile.email': 'martin@example.com' });
        expect(sendResetEmail).toHaveBeenCalledOnce();
        const [email, otp] = sendResetEmail.mock.calls[0];
        expect(email).toBe('martin@example.com');
        expect(otp).toMatch(/^\d{6}$/);
        expect(PasswordReset.findOneAndUpdate).toHaveBeenCalledOnce();
        const [filter, update, options] = PasswordReset.findOneAndUpdate.mock.calls[0];
        expect(filter).toEqual({ userId: 'user123' });
        expect(options).toEqual({ upsert: true, runValidators: true });
        expect(await bcrypt.compare(otp, update.$set.codeHash)).toBe(true);
        expect(update.$set.attempts).toBe(0);
        expect(update.$unset).toEqual({ resetTokenHash: 1 });
        expect(update.$set.expiresAt.getTime()).toBeGreaterThanOrEqual(startedAt + 600000);
        expect(update.$set.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 600000);
        expect(PasswordReset.findOneAndUpdate.mock.invocationCallOrder[0])
            .toBeLessThan(sendResetEmail.mock.invocationCallOrder[0]);
    });

    it('returns the same success message for unknown accounts without emailing', async () => {
        User.findOne.mockResolvedValue(null);
        const response = await send({ email: 'unknown@example.com' });
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ message });
        expect(PasswordReset.findOneAndUpdate).not.toHaveBeenCalled();
        expect(sendResetEmail).not.toHaveBeenCalled();
    });

    it.each([undefined, {}, { email: '' }, { email: 'bad' }, { email: 123 }])(
        'rejects invalid input %#', async body => {
            expect((await send(body)).status).toBe(400);
            expect(User.findOne).not.toHaveBeenCalled();
            expect(sendResetEmail).not.toHaveBeenCalled();
        }
    );

    it.each(['lookup', 'save', 'email'])('forwards %s failures', async stage => {
        const error = new Error('Service unavailable');
        if (stage === 'lookup') User.findOne.mockRejectedValue(error);
        if (stage === 'save') PasswordReset.findOneAndUpdate.mockRejectedValue(error);
        if (stage === 'email') sendResetEmail.mockRejectedValue(error);
        expect((await send({ email: 'martin@example.com' })).status).toBe(500);
        if (stage !== 'email') expect(sendResetEmail).not.toHaveBeenCalled();
    });
});
