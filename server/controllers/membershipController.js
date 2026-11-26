import joi from 'joi';
import { User } from '../models/User.js';
import { MembershipTier } from '../models/MembershipTier.js';

const PAID_TIERS = ['Plus', 'Premium'];

const subscribeSchema = joi.object({
    tier: joi.string().valid(...PAID_TIERS).required().messages({
        'any.only': `tier must be one of: ${PAID_TIERS.join(', ')} (Basic is the default; cancel to return to it)`
    })
});

function oneYearAfter(date) {
    const renewal = new Date(date);
    renewal.setUTCFullYear(renewal.getUTCFullYear() + 1);
    return renewal;
}

function getRenewalDate({ renewalDate, startDate }) {
    if (renewalDate !== undefined) return renewalDate;
    return startDate ? oneYearAfter(startDate) : null;
}

// GET /api/membership
export async function getMyMembership(req, res, next) {
    try {
        const user = await User.findById(req.user?.id).select('membership');
        if (!user) return res.status(401).json({ message: 'User not found' });

        const { tier, startDate } = user.membership;
        return res.status(200).json({
            membership: { tier, startDate, renewalDate: getRenewalDate(user.membership) }
        });
    } catch (error) {
        next(error);
    }
}

// POST /api/membership/subscribe
export async function subscribeToTier(req, res, next) {
    const { value, error } = subscribeSchema.validate(req.body ?? {});
    if (error) return res.status(400).json({ message: error.message });

    try {
        const tier = await MembershipTier.findById(value.tier).lean();
        if (!tier) return res.status(404).json({ message: 'Membership tier not found' });

        const startDate = new Date();
        const user = await User.findOneAndUpdate(
            { _id: req.user?.id, 'membership.tier': { $ne: tier.tier } },
            {
                $set: {
                    'membership.tier': tier.tier,
                    'membership.startDate': startDate,
                    'membership.renewalDate': oneYearAfter(startDate)
                }
            },
            { returnDocument: 'after' }
        ).select('membership');

        if (!user) {
            return res.status(409).json({ message: `You are already subscribed to ${tier.tier}` });
        }

        return res.status(200).json({
            message: `Subscribed to ${tier.tier}`,
            membership: user.membership,
            tier: {
                tier: tier.tier,
                annual_fee: tier.annual_fee,
                deposit_discount: tier.deposit_discount
            }
        });
    } catch (error) {
        next(error);
    }
}

// POST /api/membership/cancel
export async function cancelMembership(req, res, next) {
    try {
        const user = await User.findOneAndUpdate(
            { _id: req.user?.id, 'membership.tier': { $in: PAID_TIERS } },
            {
                $set: {
                    'membership.tier': 'Basic',
                    'membership.startDate': new Date(),
                    'membership.renewalDate': null
                }
            },
            { returnDocument: 'after' }
        ).select('membership');

        if (!user) {
            return res.status(409).json({ message: 'You have no paid membership to cancel' });
        }

        return res.status(200).json({
            message: 'Membership cancelled. You are back on Basic',
            membership: user.membership
        });
    } catch (error) {
        next(error);
    }
}