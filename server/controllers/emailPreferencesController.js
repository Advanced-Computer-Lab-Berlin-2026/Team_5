import joi from 'joi';
import { User } from '../models/User.js';
import { normalizeEmailPreferences } from '../utils/emailPreferences.js';

const preferenceSchema = joi.object({
    reservations: joi.boolean(),
    promotions: joi.boolean(),
    communityNotices: joi.boolean()
}).min(1).unknown(false);

// GET /api/settings/email-preferences — member/lender reading their own switches
export async function getEmailPreferences(req, res, next) {
    try {
        const user = await User.findById(req.user.id, { emailPreferences: 1 }, { lean: true });
        if (!user) return res.status(401).json({ message: 'User not found' });

        return res.status(200).json({
            emailPreferences: normalizeEmailPreferences(user.emailPreferences)
        });
    } catch (error) {
        next(error);
    }
}

// PATCH /api/settings/email-preferences — only the fields they send get flipped
export async function updateEmailPreferences(req, res, next) {
    const { value, error } = preferenceSchema.validate(req.body ?? {}, { stripUnknown: true });
    if (error) return res.status(400).json({ message: error.message });

    try {
        const updates = {};
        if (value.reservations !== undefined) updates['emailPreferences.reservations'] = value.reservations;
        if (value.promotions !== undefined) updates['emailPreferences.promotions'] = value.promotions;
        if (value.communityNotices !== undefined) {
            updates['emailPreferences.communityNotices'] = value.communityNotices;
        }

        const user = await User.findByIdAndUpdate(
            req.user.id,
            { $set: updates },
            { new: true, runValidators: true, lean: true, projection: { emailPreferences: 1 } }
        );
        if (!user) return res.status(401).json({ message: 'User not found' });

        return res.status(200).json({
            message: 'Email preferences updated',
            emailPreferences: normalizeEmailPreferences(user.emailPreferences)
        });
    } catch (error) {
        next(error);
    }
}
