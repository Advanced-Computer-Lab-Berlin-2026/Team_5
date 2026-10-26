import jwt from 'jsonwebtoken';
import { env } from '../config/env.js'
import { User } from '../models/User.js';
async function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authorization header missing or malformed.' });
    }
    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    if (!token|| token.trim() === '') {
        return res.status(401).json({ error: 'Token missing.' });
    }
    let decoded;

    try {
        decoded = jwt.verify(token, env.jwtSecret);
    } catch {
        return res.status(401).json({ error: 'Invalid or expired token.' });
    }

    let user;

    try {
        user = await User.findById(decoded.id);
    } catch (error) {
        console.error('Database error:', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }

    if (!user) {
        return res.status(401).json({ error: 'User not found.' });
    }
    if (user.suspended) {
        return res.status(403).json({ error: 'Your account has been suspended. Please contact support.' });
    }
    req.user = user;
    next();
}
export default authenticate;