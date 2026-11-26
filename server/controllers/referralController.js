import joi from 'joi';
import { User } from '../models/User.js';
import { Referral } from '../models/Referral.js';

const applyReferralSchema = joi.object({
    referralCode: joi.string().trim().required()
});

// GET /api/referrals/me
export async function getMyReferralInfo(req, res, next) {
    try {
        const userId = req.user?.id;
        const user = await User.findById(userId).select('username referral_code referredBy');
        if (!user) return res.status(401).json({ message: 'User not found' });

        const referrals = await Referral.find({ referrer: userId })
            .sort({ createdAt: -1 })
            .lean();

        return res.status(200).json({
            referralCode: user.referral_code,
            referralLink: `http://localhost:3000/register?ref=${user.referral_code}`,
            referredBy: user.referredBy ?? null,
            referrals
        });
    } catch (error) {
        next(error);
    }
}

// POST /api/referrals/apply  body: { referralCode }
export async function applyReferralCode(req, res, next) {
    const { value, error } = applyReferralSchema.validate(req.body ?? {});
    if (error) return res.status(400).json({ message: error.message });

    try {
        const userId = req.user?.id;
        const user = await User.findById(userId);
        if (!user) return res.status(401).json({ message: 'User not found' });
        if (user.referredBy) {
            return res.status(409).json({ message: 'A referral code has already been applied to your account' });
        }

        const referrer = await User.findOne({ referral_code: value.referralCode });
        if (!referrer) return res.status(404).json({ message: 'Invalid referral code' });
        if (referrer._id === userId) {
            return res.status(400).json({ message: 'You cannot refer yourself' });
        }

        await User.updateOne({ _id: userId }, { $set: { referredBy: referrer._id } });
        const referral = await Referral.create({
            referrer: referrer._id,
            referred: userId,
            status: 'sent',
            creditsIssued: 0
        });

        return res.status(201).json({
            message: 'Referral code applied successfully',
            referral
        });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ message: 'A referral code has already been applied to your account' });
        }
        next(error);
    }
}