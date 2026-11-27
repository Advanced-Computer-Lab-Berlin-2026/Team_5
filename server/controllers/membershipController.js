import joi from 'joi';
import { User } from '../models/User.js';
import { MembershipTier } from '../models/MembershipTier.js';
import { oneYearAfter, payForMembership } from '../services/membershipPaymentService.js';
import { CheckoutError } from '../utils/CheckoutError.js';

const PAID_TIERS = ['Plus', 'Premium'];

const subscribeSchema = joi.object({
    tier: joi.string().valid(...PAID_TIERS).required().messages({
        'any.only': `tier must be one of: ${PAID_TIERS.join(', ')} (Basic is the default; cancel to return to it)`
    }),
    method: joi.string().valid('wallet', 'card').required()
});

const checkoutKeySchema = joi.string().trim().max(128).required();

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
    const key = checkoutKeySchema.validate(req.get('Idempotency-Key'));
    if (key.error) return res.status(400).json({ message: 'A valid Idempotency-Key header is required.' });

    try {
        const tier = await MembershipTier.findById(value.tier).lean();
        if (!tier) return res.status(404).json({ message: 'Membership tier not found' });

        const payment = await payForMembership(req.user.id, tier, value.method, key.value);
        return res.status(payment.status === 'awaiting_payment' ? 202 : 200).json({
            ...payment,
            ...(payment.status === 'completed' ? { message: `Subscribed to ${tier.tier}` } : {}),
            tier: {
                tier: tier.tier,
                annual_fee: tier.annual_fee,
                deposit_discount: tier.deposit_discount
            }
        });
    } catch (error) {
        if (error instanceof CheckoutError) {
            return res.status(error.statusCode).json({ code: error.code, message: error.message });
        }
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
