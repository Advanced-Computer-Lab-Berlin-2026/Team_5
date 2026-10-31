import joi from 'joi';
import { User } from '../models/User.js';

const PHONE_NUMBER_REGEX_PATTERN = /^\+[1-9]\d{1,14}$/;

const updateProfileSchema = joi.object({
    phoneNumber: joi.string().pattern(PHONE_NUMBER_REGEX_PATTERN).allow(''),
    homeAddress: joi.string().trim().max(200).allow('')
}).or('phoneNumber', 'homeAddress');

// PATCH /api/profile
export async function updateProfile(req, res, next) {
    const { value, error } = updateProfileSchema.validate(req.body ?? {});
    if (error) return res.status(400).json({ message: error.message });

    try {
        const userId = req.user?.id;
        const updates = {};

        if (value.phoneNumber !== undefined) {
            updates['profile.phone'] = value.phoneNumber;
        }
        if (value.homeAddress !== undefined) {
            updates['profile.address'] = value.homeAddress;
        }

        const user = await User.findByIdAndUpdate(
            userId,
            { $set: updates },
            { new: true, runValidators: true }
        ).select('profile');

        if (!user) return res.status(401).json({ message: 'User not found' });

        return res.status(200).json({
            message: 'Profile updated successfully',
            profile: user.profile
        });
    } catch (error) {
        next(error);
    }
}