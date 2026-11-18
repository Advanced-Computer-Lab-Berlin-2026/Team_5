import { User } from '../models/User.js';
import { Reservation } from '../models/Reservation.js';
import { DamageReport } from '../models/DamageReport.js';

const BASE_SCORE = 50;
const POINTS_PER_COMPLETED = 2;
const MAX_COMPLETED_BONUS = 20;
const MAX_ON_TIME_BONUS = 20;
const DAMAGE_PENALTY = 15;

function isReturnedOnTime(reservation) {
    const returnedAt = reservation.handover?.returnedAt;
    if (!returnedAt || !reservation.endDate) return true;
    return new Date(returnedAt) <= new Date(reservation.endDate);
}

export function computeTrustScore(completedCount, onTimeCount, borrowerCompletedCount, damageCount) {
    const completedBonus = Math.min(MAX_COMPLETED_BONUS, completedCount * POINTS_PER_COMPLETED);
    const onTimeRate = borrowerCompletedCount > 0 ? onTimeCount / borrowerCompletedCount : 0;
    const onTimeBonus = Math.round(onTimeRate * MAX_ON_TIME_BONUS);
    const penalty = damageCount * DAMAGE_PENALTY;

    const raw = BASE_SCORE + completedBonus + onTimeBonus - penalty;
    return Math.max(0, Math.min(100, raw));
}

// Recalculates and saves a user's trustScore (0-100) from their reservation & damage history
export async function recalculateTrustScore(username, session = null) {
    if (!username) return null;

    const completedReservations = await Reservation.find({
        status: 'completed',
        $or: [{ borrower: username }, { lender: username }]
    })
        .select('borrower lender endDate handover.returnedAt')
        .session(session)
        .lean();

    const borrowerReservations = completedReservations.filter((r) => r.borrower === username);
    const onTimeCount = borrowerReservations.filter(isReturnedOnTime).length;
    const borrowerResIds = borrowerReservations.map((r) => r._id);

    const damageCount = borrowerResIds.length > 0
        ? await DamageReport.countDocuments({
            reservation: { $in: borrowerResIds },
            type: 'report'
        }).session(session)
        : 0;

    const trustScore = computeTrustScore(
        completedReservations.length,
        onTimeCount,
        borrowerReservations.length,
        damageCount
    );

    await User.updateOne(
        { _id: username },
        { $set: { trustScore } },
        session ? { session } : {}
    );

    return trustScore;
}