import { User } from '../models/User.js';

const ITEM_ID_PATTERN = /^ITM-[0-9a-f]{8}$/;

// DELETE /api/borrow-list/:itemId
export async function removeFromBorrowList(req, res, next) {
    try {
        const userId = req.user?.id;
        const { itemId } = req.params;

        if (!ITEM_ID_PATTERN.test(itemId)) {
            return res.status(400).json({ message: 'Invalid item id' });
        }

        const result = await User.updateOne(
            { _id: userId },
            { $pull: { borrow_list: { item: itemId } } }
        );

        if (result.matchedCount === 0) {
            return res.status(401).json({ message: 'User not found' });
        }
        if (result.modifiedCount === 0) {
            return res.status(404).json({ message: 'Item not in borrow list' });
        }

        const user = await User.findById(userId)
            .select('borrow_list')
            .populate('borrow_list.item');

        return res.status(200).json({
            message: 'Item removed from borrow list',
            borrowList: user.borrow_list
        });
    } catch (error) {
        next(error);
    }
}