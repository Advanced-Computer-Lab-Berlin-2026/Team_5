import { rateLimit } from 'express-rate-limit';

// Read-only requests need no CSRF check. Never change data in GET/HEAD handlers.
export function csrfProtection(req, res, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    return requireTrustedOrigin(req, res, next);
}

// Compare exact origins, including scheme and port. Never derive trust from Host.
export function requireTrustedOrigin(req, res, next) {
    const allowed = ('http://localhost:3000') //for now
        .split(',').map(value => value.trim());
    const origin = req.get('Origin');
    const referer = req.get('Referer');
    let source;
    try {
        source = origin ?? (referer ? new URL(referer).origin : undefined);
    } catch {
        return res.status(403).json({ message: 'Untrusted request origin' });
    }
    if (!source || source === 'null' || !allowed.includes(source)) {
        return res.status(403).json({ message: 'Untrusted request origin' });
    }
    next();
}

export function createAuthLimiter(limit, windowMs = 15 * 60 * 1000) {
    return rateLimit({
        windowMs,
        limit,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: { message: 'Too many requests. Please try again later.' }
    });
}

// Separate budgets stop refresh traffic from exhausting the login allowance.
export const authLimiters = {
    login: createAuthLimiter(20),
    register: createAuthLimiter(10),
    passwordReset: createAuthLimiter(10),
    refresh: createAuthLimiter(60, 60 * 1000),
    logout: createAuthLimiter(30, 60 * 1000)
};
