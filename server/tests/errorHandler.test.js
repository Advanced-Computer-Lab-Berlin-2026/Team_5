import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { notFound, errorHandler } from '../middleware/errorHandler.js';

// Fake Express response so the handlers can be called directly, without a server
const fakeRes = () => {
    const res = {};
    res.status = vi.fn(() => res);
    res.json = vi.fn(() => res);
    return res;
};

// Calls errorHandler with the given error and returns the fake response
const handle = err => {
    const res = fakeRes();
    errorHandler(err, {}, res, vi.fn());
    return res;
};

beforeEach(() => {
    // server errors are logged; keep the test output clean
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('notFound', () => {
    it('answers 404 with a JSON message', () => {
        const res = fakeRes();
        notFound({}, res);
        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith({ message: 'Endpoint not found' });
    });

    it('is used by the app for unknown URLs', async () => {
        const response = await request(app).get('/api/does-not-exist');
        expect(response.status).toBe(404);
        expect(response.body).toEqual({ message: 'Endpoint not found' });
    });
});

describe('errorHandler', () => {
    describe('client errors (4xx)', () => {
        it('keeps the status and message', () => {
            const res = handle(Object.assign(new Error('Bad input'), { status: 400 }));
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({ message: 'Bad input' });
            expect(console.error).not.toHaveBeenCalled();
        });

        // express.json() throws a 400 error for broken JSON bodies
        it('answers broken JSON in a request with 400', async () => {
            const response = await request(app)
                .post('/api/auth/login').set('Origin', 'http://localhost:3000')
                .set('Content-Type', 'application/json')
                .send('{ not json');
            expect(response.status).toBe(400);
        });
    });

    describe('server errors (5xx)', () => {
        it('uses 500 when the error has no status', () => {
            const res = handle(new Error('Database unavailable'));
            expect(res.status).toHaveBeenCalledWith(500);
        });

        it('hides the real message from the client but logs it', () => {
            const error = new Error('Database unavailable');
            const res = handle(error);
            expect(res.json).toHaveBeenCalledWith({ message: 'Server Error' });
            expect(console.error).toHaveBeenCalledWith(error);
        });

        it('hides the message for other 5xx statuses too', () => {
            const res = handle(Object.assign(new Error('Upstream down'), { status: 503 }));
            expect(res.status).toHaveBeenCalledWith(503);
            expect(res.json).toHaveBeenCalledWith({ message: 'Server Error' });
        });
    });
});
