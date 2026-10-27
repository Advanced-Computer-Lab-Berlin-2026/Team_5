import { User } from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';

// GET /api/wallet
export async function getWalletBalance(req, res, next) {
    try {
        // uses dummy function to get user id from cookie, will be replaced with middleware later
        //const userId = await getUserIdFromCookie(req);

        requireAuth(req, res, () => {}); // Call requireAuth to ensure the user is authenticated
        const userId = req.user?.id;

        if (!userId) return res.status(401).json({ message: 'User id is null' });

        const user = await User.findById(userId).select('wallet');
        if (!user) return res.status(401).json({ message: 'User not found' });

        return res.status(200).json({ balance: user.wallet });
    } catch (error) {
        next(error);
    }
}