import { User } from '../models/User.js';

// Users made before renewalDate existed have none, so fall back to one year after the start date
function getRenewalDate({ renewalDate, startDate }) {
    if (renewalDate) return renewalDate;
    if (!startDate) return null;

    const renewal = new Date(startDate);
    renewal.setUTCFullYear(renewal.getUTCFullYear() + 1);
    return renewal;
}

// GET /api/membership
// SCRUM-384 (S86): the logged-in user's own tier, start date and renewal date
export async function getMyMembership(req, res, next) {
    try {
        const userId = req.user?.id;

        const user = await User.findById(userId).select('membership');
        if (!user) return res.status(401).json({ message: 'User not found' });

        const { tier, startDate } = user.membership;

        return res.status(200).json({
            membership: { tier, startDate, renewalDate: getRenewalDate(user.membership) }
        });
    } catch (error) {
        next(error);
    }
}
