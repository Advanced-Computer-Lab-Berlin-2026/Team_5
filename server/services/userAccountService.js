import { Item } from '../models/Item.js';
import { PasswordReset } from '../models/PasswordReset.js';
import { RefreshSession } from '../models/RefreshSession.js';
import { User } from '../models/User.js';
import { Waitlist } from '../models/Waitlist.js';

export async function deleteUserAccount(userId, session) {
    const user = await User.findById(userId, null, { session });
    if (!user) return false;

    const ownedItems = await Item.find({ owner: userId }, '_id', { session });
    const itemIds = ownedItems.map((item) => item._id);

    if (itemIds.length > 0) {
        await User.updateMany(
            { _id: { $ne: userId } },
            { $pull: { wishlist: { $in: itemIds } } },
            { session }
        );
        await Waitlist.deleteMany({ item: { $in: itemIds } }, { session });
    }

    await Waitlist.updateMany({ usernames: userId }, { $pull: { usernames: userId } }, { session });
    await PasswordReset.deleteMany({ userId }, { session });
    await Item.deleteMany({ owner: userId }, { session });
    await RefreshSession.deleteMany({ userId }, { session });

    const deletedUser = await User.findByIdAndDelete(userId, { session });
    return Boolean(deletedUser);
}