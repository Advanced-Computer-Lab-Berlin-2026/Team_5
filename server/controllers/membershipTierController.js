import { MembershipTier } from '../models/MembershipTier.js';

// GET /api/membership-tiers
// SCRUM-381 (S83): lists every membership tier, cheapest first
export async function listMembershipTiers(req, res, next) {
    try {
        const tiers = await MembershipTier.find().sort({ annual_fee: 1 }).lean();

        return res.status(200).json({
            tiers: tiers.map(({ tier, annual_fee, deposit_discount }) => ({ tier, annual_fee, deposit_discount }))
        });
    } catch (error) {
        next(error);
    }
}
