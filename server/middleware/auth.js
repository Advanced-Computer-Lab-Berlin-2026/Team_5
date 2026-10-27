import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User } from '../models/User.js';

// Returns the token from the "Authorization: Bearer <token>" header, or null if there is none
function getBearerToken(req) {
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    return scheme === 'Bearer' && token ? token : null;
}

// Returns what is stored inside the token, or null if the token is fake or expired
function readToken(token) {
    try {
        return jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] });
    } catch {
        return null;
    }
}

// Only lets logged-in users through and stores them on req.user as { id, username, role }
export async function requireAuth(req, res, next) {
    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ message: 'Authentication required' });

    const payload = readToken(token);
    if (!payload) return res.status(401).json({ message: 'Invalid or expired access token' });

    try {
        // load the user from the database so the role and suspension are always up to date
        const user = await User.findById(payload.id);
        if (!user) return res.status(401).json({ message: 'Invalid or expired access token' });
        if (user.suspended) return res.status(403).json({ message: 'Your account is suspended' });

        req.user = { id: user._id, username: user.username, role: user.role };
        next();
    } catch (error) {
        next(error);
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