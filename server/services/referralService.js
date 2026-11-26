import { Referral } from '../models/Referral.js';
import { User } from '../models/User.js';
import { Payment } from '../models/Payment.js';

export const REFERRAL_CREDIT_AMOUNT = 50;

// Atomically converts a pending referral when the referred user completes their first reservation
export async function rewardReferralIfEligible(borrowerUsername, reservationId, session = null) {
    if (!borrowerUsername) return null;

    const referral = await Referral.findOneAndUpdate(
        { referred: borrowerUsername, status: 'sent' },
        {
            $set: {
                status: 'converted',
                creditsIssued: REFERRAL_CREDIT_AMOUNT,
                convertedAt: new Date()
            }
        },
        { new: true, session }
    );

    if (!referral) return null;

    await User.updateOne(
        { _id: referral.referrer },
        { $inc: { wallet: REFERRAL_CREDIT_AMOUNT } },
        session ? { session } : {}
    );

    await Payment.create([{
        user: referral.referrer,
        reservation: reservationId,
        type: 'referral-credit',
        amount: REFERRAL_CREDIT_AMOUNT,
        direction: 'receive',
        method: 'wallet',
        description: `Referral reward for ${borrowerUsername}'s first completed reservation`
    }], session ? { session } : {});

    return referral;
}