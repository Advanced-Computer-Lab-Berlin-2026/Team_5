import crypto from 'node:crypto';
import { RefreshSession } from './models/RefreshSession.js';
/* 
this is a temporary file made till we implement the middleware 
it will most likly be deleted after
*/

// Function to get user ID from req by cookie

export async function getUserIdFromCookie(req) {
    const refreshToken = req.cookies?.refreshToken;

    console.log('Refresh Token from Cookie:', refreshToken); // Log the refresh token for debugging 
    
    if (typeof refreshToken !== 'string' || !refreshToken) return null;

    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

    console.log('Token Hash:', tokenHash); // Log the token hash for debugging

    const session = await RefreshSession.findOne({
        tokenHash,
        expiresAt: { $gt: new Date() }
    });

    console.log('Session Found:', session); // Log the session for debugging

    console.log('User ID from Session:', session ? session.userId : null); // Log the user ID for debugging

    return session ? session.userId : null;
}
