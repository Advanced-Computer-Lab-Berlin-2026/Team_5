import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User } from '../models/User.js';

// Returns the access token from the httpOnly "accessToken" cookie, or null if there is none
function getAccessToken(req) {
    const token = req.cookies?.accessToken;
    return typeof token === 'string' && token ? token : null;
}

// Returns { payload } for a valid token, { expired: true } for an expired one, or {} if it is fake
function readToken(token) {
    try {
        return { payload: jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] }) };
    } catch (error) {
        return error instanceof jwt.TokenExpiredError ? { expired: true } : {};
    }
}

// Only lets logged-in users through and stores them on req.user as { id, username }
export async function requireAuth(req, res, next) {
    const token = getAccessToken(req);
    if (!token) return res.status(401).json({ message: 'Authentication required' });

    const { payload, expired } = readToken(token);
    // the client should call POST /api/auth/refresh and retry the request
    if (expired) return res.status(401).json({ message: 'Access token expired', code: 'TOKEN_EXPIRED' });
    if (!payload?.id) return res.status(401).json({ message: 'Invalid access token' });

    // the user id is the username
    // req.user = { id: payload.id, role: payload.role };
    // next();
    try {
        const user = await User.findById(payload.id);
        if (!user) return res.status(401).json({ message: 'User not found' });
        if (user.suspended){
            res.clearCookie('accessToken', { path: '/' });
            res.clearCookie('refreshToken', { path: '/api/auth' });
            return res.status(403).json({ message: 'User account is suspended' });
        }
        req.user = { id: payload.id, role: user.role };
        next();
    } catch (error) {
        console.error('Error in requireAuth middleware:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
}

// Only lets users whose role is in the list through ('member', 'lender' or 'admin').
export function requireRole(...allowedRoles) {
    return function checkRole(req, res, next) {
        if (!req.user) return res.status(401).json({ message: 'Authentication required' });
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ message: 'You do not have permission to do this' });
        }
        next();
    };
}
