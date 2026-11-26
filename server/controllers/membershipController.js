import joi from 'joi';
import { User } from '../models/User.js';
import { MembershipTier } from '../models/MembershipTier.js';

// Basic is the default tier with no fee, so nobody "subscribes" to it. They get it back by cancelling.
const PAID_TIERS = ['Plus', 'Premium'];

const subscribeSchema = joi.object({
    tier: joi.string().valid(...PAID_TIERS).required().messages({
        'any.only': `tier must be one of: ${PAID_TIERS.join(', ')} (Basic is the default; cancel to return to it)`
    })
});

// a paid subscription lasts one year
function oneYearAfter(date) {
    const renewal = new Date(date);
    renewal.setUTCFullYear(renewal.getUTCFullYear() + 1);
    return renewal;
}

// POST /api/membership/subscribe  body: { tier }
export async function subscribeToTier(req, res, next) {
    const { value, error } = subscribeSchema.validate(req.body ?? {});
    if (error) return res.status(400).json({ message: error.message });

    try {
        const userId = req.user?.id;

        const tier = await MembershipTier.findById(value.tier).lean();
        if (!tier) return res.status(404).json({ message: 'Membership tier not found' });

        // the tier check is part of the update itself, so two quick clicks cannot both succeed
        const startDate = new Date();
        const user = await User.findOneAndUpdate(
            { _id: userId, 'membership.tier': { $ne: tier.tier } },
            { $set: { 'membership.tier': tier.tier, 'membership.startDate': startDate, 'membership.renewalDate': oneYearAfter(startDate) } },
            { returnDocument: 'after' }
        ).select('membership');

        if (!user) return res.status(409).json({ message: `You are already subscribed to ${tier.tier}` });

        return res.status(200).json({
            message: `Subscribed to ${tier.tier}`,
            membership: user.membership,
            tier: { tier: tier.tier, annual_fee: tier.annual_fee, deposit_discount: tier.deposit_discount }
        });
    } catch (error) {
        next(error);
    }
}

// POST /api/membership/cancel  (no body)
// Cancelling takes effect immediately: the member goes back to Basic right away, with no refund of the fee.
export async function cancelMembership(req, res, next) {
    try {
        const userId = req.user?.id;

        const startDate = new Date();
        const user = await User.findOneAndUpdate(
            { _id: userId, 'membership.tier': { $in: PAID_TIERS } },
            { $set: { 'membership.tier': 'Basic', 'membership.startDate': startDate, 'membership.renewalDate': null } },
            { returnDocument: 'after' }
        ).select('membership');

        if (!user) return res.status(409).json({ message: 'You have no paid membership to cancel' });

        return res.status(200).json({ message: 'Membership cancelled. You are back on Basic', membership: user.membership });
    } catch (error) {
        next(error);
    }
}
