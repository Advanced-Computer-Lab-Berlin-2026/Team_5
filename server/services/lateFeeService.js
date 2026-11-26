import { Item } from '../models/Item.js';
import { User } from '../models/User.js';
import { Payment } from '../models/Payment.js';
import { Reservation } from '../models/Reservation.js';
import { CheckoutError } from '../utils/CheckoutError.js';
import { notifyInApp } from './notificationService.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// SCRUM-467
export function calculateLateFee({
    endDate,
    returnedAt,
    lateFeePerDay
}) {
    const dueTime = new Date(endDate).getTime();
    const returnTime = new Date(returnedAt).getTime();

    if (
        !Number.isFinite(dueTime) ||
        !Number.isFinite(returnTime) ||
        !Number.isFinite(lateFeePerDay) ||
        lateFeePerDay < 0
    ) {
        throw new Error('Invalid late-fee calculation inputs.');
    }

    const daysLate = Math.max(
        0,
        Math.ceil((returnTime - dueTime) / MS_PER_DAY)
    );

    const lateFee = Math.round(
        daysLate * lateFeePerDay * 100
    ) / 100;

    return { daysLate, lateFee };
}

// SCRUM-468
// Must be called inside the existing return transaction.
export async function chargeLateFeeForReturn(reservation, session) {
    const item = await Item.findById(
        reservation.item
    ).session(session);

    if (!item) {
        throw new CheckoutError(
            409,
            'ITEM_NOT_FOUND',
            'Item not found for late-fee calculation.'
        );
    }

    const { daysLate, lateFee } = calculateLateFee({
        endDate: reservation.endDate,
        returnedAt: reservation.handover.returnedAt,
        lateFeePerDay: item.borrowingRules?.lateFeePerDay ?? 0
    });

    if (lateFee > 0) {
        // No balance check: the wallet may go below 0, and the negative balance is what the
        // borrower still owes (same as damage resolutions). Otherwise a borrower with an empty
        // wallet would block the return and the reservation would stay active forever.
        const member = await User.findOneAndUpdate(
            { _id: reservation.borrower },
            { $inc: { wallet: -lateFee } },
            { session, new: true }
        );

        // The borrower's account was deleted: roll back instead of logging a fee nobody paid.
        if (!member) {
            throw new CheckoutError(
                404,
                'BORROWER_NOT_FOUND',
                `User ${reservation.borrower} not found`
            );
        }

        await Payment.create([{
            user: reservation.borrower,
            reservation: reservation._id,
            type: 'late-fee',
            amount: lateFee,
            direction: 'deduct',
            method: 'wallet',
            status: 'completed',
            description: `Late fee for ${daysLate} overdue day(s)`
        }], { session });

        await notifyInApp(reservation.borrower, {
            reservation: reservation._id,
            message: `A late fee of €${lateFee.toFixed(2)} was charged for reservation ${reservation._id}.`
        }, session);
    }

    await Reservation.updateOne(
        {
            _id: reservation._id,
            status: 'completed'
        },
        {
            $set: {
                'payment.lateFee': lateFee
            }
        },
        { session }
    );

    return { daysLate, lateFee };
}
