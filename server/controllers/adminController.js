import { User } from '../models/User.js';
import { RefreshSession } from '../models/RefreshSession.js';

async function updateSuspension(req, res) {
    try {
        const userId = req.params.id;
        const { suspended } = req.body ?? {};
        if (typeof suspended !== 'boolean') {
            return res.status(400).json({ error: 'Suspension status must be a boolean.' });
        }
        if (typeof userId !== 'string' || !userId.trim()) {
            return res.status(400).json({ error: 'Invalid user ID.' });
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
        if (typeof userId !== 'string' || !userId.trim()) {
            return res.status(400).json({ error: 'Invalid user ID.' });
        }
        const user = await User.findById(userId).select('-password -__v');
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

export { updateSuspension, viewUserDetails };