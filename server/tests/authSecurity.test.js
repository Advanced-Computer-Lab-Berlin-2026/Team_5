import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createAuthLimiter, requireTrustedOrigin } from '../middleware/authSecurity.js';
import app from '../app.js';

describe('API-wide CSRF protection', () => {
    it.each(['post', 'put', 'patch', 'delete'])(
        'blocks %s outside auth routes even with an auth cookie', async method => {
            const response = await request(app)[method]('/api/future-resource')
                .set('Cookie', 'accessToken=some-token')
                .set('Origin', 'https://evil.example');
            expect(response.status).toBe(403);
            expect(response.body.message).toBe('Untrusted request origin');
        }
    );

    it('rejects missing origin and accepts trusted Origin or Referer before routing', async () => {
        expect((await request(app).post('/api/future-resource')).status).toBe(403);
        // A 404 means the request passed CSRF protection and reached routing.
        expect((await request(app).post('/api/future-resource')
            .set('Origin', 'http://localhost:3000')).status).toBe(404);
        expect((await request(app).post('/api/future-resource')
            .set('Referer', 'http://localhost:3000/items')).status).toBe(404);
    });

    it('allows read-only requests and preflight requests without origin', async () => {
        expect((await request(app).get('/api/health')).status).toBe(200);
        expect((await request(app).head('/api/health')).status).toBe(200);
        expect((await request(app).options('/api/auth/login')).status).toBe(200);
    });
});

describe('auth origin protection', () => {
    const app = express();
    app.post('/', requireTrustedOrigin, (req, res) => res.sendStatus(204));

    it.each([undefined, 'null', 'https://evil.example', 'http://localhost:3000.evil.example'])(
    'rejects untrusted or missing origin %s', async origin => {
        const pending = request(app).post('/');
        if (origin) pending.set('Origin', origin);
        expect((await pending).status).toBe(403);
    });

    it('accepts the trusted localhost origin and Referer fallback', async () => {
        expect((await request(app).post('/').set('Origin', 'http://localhost:3000')).status).toBe(204);
        expect((await request(app).post('/').set('Referer', 'http://localhost:3000/login')).status).toBe(204);
        expect((await request(app).post('/').set('Referer', 'invalid')).status).toBe(403);
        expect((await request(app).post('/').set('Origin', 'null')
            .set('Referer', 'http://localhost:3000/login')).status).toBe(403);
    });
});

it('limits repeated requests, ignores spoofed forwarding headers, and recovers after the window', async () => {
    const app = express();
    app.post('/', createAuthLimiter(2, 1000), (req, res) => res.sendStatus(204));
    expect((await request(app).post('/')).status).toBe(204);
    expect((await request(app).post('/')).status).toBe(204);
    const blocked = await request(app).post('/').set('Forwarded', 'for=192.0.2.1');
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1100);
    try {
        expect((await request(app).post('/')).status).toBe(204);
    } finally {
        vi.restoreAllMocks();
    }
});
