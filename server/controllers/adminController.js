import { User } from '../models/User.js';
import { RefreshSession } from '../models/RefreshSession.js';
import { Category } from '../models/Category.js';

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

async function updateCategoryDepositMultiplier(req, res) {
    try {
        const { depositMultiplier } = req.body ?? {};
        if (
            typeof depositMultiplier !== 'number' ||
            !Number.isFinite(depositMultiplier) ||
            depositMultiplier < 1
        ) {
            return res.status(400).json({
                error: 'Deposit multiplier must be a finite number greater than or equal to 1.'
            });
        }

        const category = await Category.findById(req.params.id);
        if (!category) {
            return res.status(404).json({ error: 'Category not found.' });
        }

        category.depositMultiplier = depositMultiplier;
        await category.save();

        return res.status(200).json({ category });
    } catch (error) {
        console.error('Error updating category deposit multiplier:', error);
        return res.status(500).json({
            error: 'An error occurred while updating the category deposit multiplier.'
        });
    }
}

export { updateSuspension, viewUserDetails, updateCategoryDepositMultiplier };