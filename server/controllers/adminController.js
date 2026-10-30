import { User } from '../models/User.js';
import { RefreshSession } from '../models/RefreshSession.js';
import { Item } from '../models/Item.js';
import { Waitlist } from '../models/Waitlist.js';
import { PasswordReset } from '../models/PasswordReset.js';
import mongoose from 'mongoose';

async function updateSuspension(req, res) {
    try {
        const userId = req.params.id;
        const { suspended } = req.body ?? {};
        if (typeof suspended !== 'boolean') {
            return res.status(400).json({ error: 'Suspension status must be a boolean.' });
        }
        
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found.' });
        }
        if (user.role !== 'member' && user.role !== 'lender') {
            return res.status(403).json({ error: 'You can only suspend members or lenders.' });
        }
        user.suspended = suspended;
        await user.save();
        if(suspended) {
            await RefreshSession.deleteMany({ userId: user._id });
        }
        res.status(200).json({ message: `User suspension status updated to ${suspended}.` });
    } catch (error) {
        console.error('Error updating suspension status:', error);
        res.status(500).json({ error: 'An error occurred while updating suspension status.' });
    }
}

async function viewUserDetails(req, res) {
    try {
        const userId = req.params.id;
        const profileFields = 'username role profile.name profile.email profile.phone profile.address';
        const user = await User.findById(userId).select(profileFields);
        if (!user) {
            return res.status(404).json({ error: 'User not found.' });
        }
        if (user.role !== 'member' && user.role !== 'lender') {
            return res.status(403).json({ error: 'You can only view details of members or lenders.' });
        }
        res.status(200).json({ user });
    } catch (error) {
        console.error('Error viewing user details:', error);
        res.status(500).json({ error: 'An error occurred while viewing user details.' });
    }
}

async function listUsers(req, res) {
    try {
        const users = await User.find({ role: { $in: ['member', 'lender'] } }).select('username role profile.name profile.email profile.phone verification.status suspended')
        .sort({ createdAt: -1 });
        res.status(200).json({ users });
    } catch (error) {
        console.error('Error listing users:', error);
        res.status(500).json({ error: 'An error occurred while listing users.' });
    }
}

async function listItems(req,res) {
    try{
        const items = await Item.find({}).sort({ createdAt: -1 });
        res.status(200).json({ items });
    } catch (error) {
        console.error('Error listing users:', error);
        res.status(500).json({ error: 'An error occurred while listing items.' });
    }
    
}

async function removeUser(req, res) {
  try {
    const userId = req.params.id;
    const user = await User.findById(userId);
    if (!user) {
    return res.status(404).json({ error: 'User not found.' });
    }
    const session = await mongoose.startSession();

    try {
    await session.withTransaction(async () => {

        // 1. Get the IDs of all items owned by this user
        const ownedItems = await Item.find(
            { owner: userId },
            '_id',
            { session }
        );

        const itemIds = ownedItems.map(item => item._id);

        // 2. Remove deleted items from other users' wishlists
        if (itemIds.length > 0) {
            await User.updateMany(
                { _id: { $ne: userId } },
                {
                    $pull: {
                        wishlist: { $in: itemIds }
                    }
                },
                { session }
            );

            // 3. Delete waitlists for deleted items
            await Waitlist.deleteMany(
                { item: { $in: itemIds } },
                { session }
            );
        }

        // 4. Remove the deleted user from other item waitlists
        await Waitlist.updateMany(
            { usernames: userId },
            { $pull: { usernames: userId } },
            { session }
        );

        // 5. Delete password-reset tokens
        await PasswordReset.deleteMany(
            { userId },
            { session }
        );

        // 6. Delete the user's actual item listings
        await Item.deleteMany(
            { owner: userId },
            { session }
        );

        // 7. Delete refresh sessions
        await RefreshSession.deleteMany(
            { userId },
            { session }
        );

        // 8. Delete the user
        await User.findByIdAndDelete(
            userId,
            { session }
        );

    });
    } finally {
        await session.endSession();
    }
    if (req.user.id === userId) {
        res.clearCookie('accessToken', { path: '/' });
        res.clearCookie('refreshToken', { path: '/api/auth' });
    }
    res.status(200).json({
        message: 'User deleted successfully.'
    });

  } catch (error) {
    console.error('Error removing user:', error);
    res.status(500).json({
      error: 'An error occurred while removing the user.'
    });
  }
}

export { updateSuspension, viewUserDetails, listUsers, listItems, removeUser };