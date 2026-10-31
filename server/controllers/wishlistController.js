import { User } from '../models/User.js';
import {  Item } from '../models/Item.js';

// item ids look like ITM-1a2b3c4d (see the default in models/Item.js), not like Mongo ObjectIds
const ITEM_ID_PATTERN = /^ITM-[0-9a-f]{8}$/;

// POST /api/wishlist/:itemId
export async function addToWishlist(req, res, next) {
   try {

         const userId = req.user?.id;

        const { itemId } = req.params;
        if (!ITEM_ID_PATTERN.test(itemId)) return res.status(400).json({ message: 'Invalid item id' });

        const item = await  Item.exists({ _id: itemId });
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

         const userId = req.user?.id;

        const { itemId } = req.params;
        if (!ITEM_ID_PATTERN.test(itemId)) return res.status(400).json({ message: 'Invalid item id' });

        const result = await User.updateOne({ _id: userId }, { $pull: { wishlist: itemId } });
        if (result.modifiedCount === 0) return res.status(404).json({ message: 'Item not in wishlist' });
        const user = await User.findById(userId).select('wishlist').populate('wishlist');
        return res.status(200).json({ message: 'Item removed from wishlist', wishlist: user.wishlist });
    } catch (error) {
        next(error);
    }
}

// GET /api/wishlist
export async function getWishlist(req, res, next) {
    try {

         const userId = req.user?.id;

        const user = await User.findById(userId).select('wishlist').populate('wishlist');
        if (!user) return res.status(401).json({ message: 'User not found' });

        return res.status(200).json({ wishlist: user.wishlist });
    } catch (error) {
        next(error);
    }
}
