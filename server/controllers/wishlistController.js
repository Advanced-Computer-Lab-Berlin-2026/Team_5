import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { getUserIdFromCookie } from '../getUserIdFromCookieDummy.js';
import { ItemListing } from '../models/ItemListing.js';

    // uses dummy function to get user id from cookie, will be replaced with middleware later

// POST /api/wishlist/:itemId
export async function addToWishlist(req, res, next) {
   try {
        const userId = await getUserIdFromCookie(req);
        if (!userId) return res.status(401).json({ message: 'user is null' });

        const { itemId } = req.params;
        if (!mongoose.isValidObjectId(itemId)) return res.status(400).json({ message: 'Invalid item id' });

        const item = await ItemListing.exists({ _id: itemId });
        if (!item) return res.status(404).json({ message: 'Item not found' });

        const result = await User.updateOne({ _id: userId }, { $addToSet: { wishlist: itemId } });
        if (result.matchedCount === 0) return res.status(401).json({ message: 'Not authenticated' });
        if (result.modifiedCount === 0) return res.status(409).json({ message: 'Item already in wishlist' });

        return res.status(200).json({ message: 'Item added to wishlist' });
    } catch (error) {
        next(error);
    }
}

// DELETE /api/wishlist/:itemId
export async function removeFromWishlist(req, res, next) {
    try {
        const userId = await getUserIdFromCookie(req);
        if (!userId) return res.status(401).json({ message: 'user is null' });

        const { itemId } = req.params;
        if (!mongoose.isValidObjectId(itemId)) return res.status(400).json({ message: 'Invalid item id' });

        const result = await User.updateOne({ _id: userId }, { $pull: { wishlist: itemId } });
        if (result.modifiedCount === 0) return res.status(404).json({ message: 'Item not in wishlist' });

        return res.status(200).json({ message: 'Item removed from wishlist' });
    } catch (error) {
        next(error);
    }
}

// GET /api/wishlist
export async function getWishlist(req, res, next) {
    try {
        const userId = await getUserIdFromCookie(req);
        if (!userId) return res.status(401).json({ message: 'user is null' });

        const user = await User.findById(userId).select('wishlist').populate('wishlist');
        if (!user) return res.status(401).json({ message: 'user not' });

        return res.status(200).json({ wishlist: user.wishlist });
    } catch (error) {
        next(error);
    }
}
