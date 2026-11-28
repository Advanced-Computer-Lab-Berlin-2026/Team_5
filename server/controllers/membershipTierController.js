import { MembershipTier } from '../models/MembershipTier.js';
import { MAX_CONCURRENT_RESERVATIONS, WAITLIST_PRIORITY } from '../services/membershipService.js';

// GET /api/membership-tiers
// SCRUM-381 (S83): lists every membership tier, cheapest first
export async function listMembershipTiers(req, res, next) {
    try {
        const tiers = await MembershipTier.find().sort({ annual_fee: 1 }).lean();

        return res.status(200).json({
            tiers: tiers.map(({ tier, annual_fee, deposit_discount, waitlistPriority, maxConcurrentReservations }) => ({
                tier,
                annual_fee,
                deposit_discount,
                waitlistPriority: waitlistPriority ?? WAITLIST_PRIORITY[tier] ?? WAITLIST_PRIORITY.Basic,
                maxConcurrentReservations: maxConcurrentReservations ?? MAX_CONCURRENT_RESERVATIONS[tier] ?? MAX_CONCURRENT_RESERVATIONS.Basic
            }))
        });
    } catch (error) {
        next(error);
    }
}
