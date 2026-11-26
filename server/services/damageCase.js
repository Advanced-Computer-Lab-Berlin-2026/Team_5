import { Reservation } from '../models/Reservation.js';
import { DamageReport } from '../models/DamageReport.js';
import { User } from '../models/User.js';
import { Payment } from '../models/Payment.js';

// A damage case is all DamageReport steps of one reservation:
// report (lender) -> decision (admin, money moves) -> dispute (borrower) -> resolution (admin, the difference moves)
// With no dispute within 7 days of the decision, a resolution with the decision's amount is saved automatically.

export const DISPUTE_DAYS = 7;
export const DAMAGE_REPORT_ID_PATTERN = /^DMG-[0-9a-f]{8}$/;

// the unique (reservation, type) index refused a second step of the same type
export const isDuplicateStep = (error) => error?.code === 11000;

export function disputeDeadline(decision) {
    const deadline = new Date(decision.createdAt);
    deadline.setDate(deadline.getDate() + DISPUTE_DAYS);
    return deadline;
}

// Saves a resolution for every decision whose 7 days are over and that nobody disputed.
// Runs before any damage case is shown, so an expired decision is never shown without its resolution.
// Pass a reservation id to check just that one case.
export async function closeExpiredDecisions(reservationId) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - DISPUTE_DAYS);

    const oneCase = reservationId ? { reservation: reservationId } : {};
    const movedOn = await DamageReport.distinct('reservation', { ...oneCase, type: { $in: ['dispute', 'resolution'] } });
    const expired = await DamageReport.find({
        type: 'decision',
        createdAt: { $lt: cutoff },
        reservation: reservationId ? { $eq: reservationId, $nin: movedOn } : { $nin: movedOn },
    });

    for (const decision of expired) {
        try {
            await DamageReport.create({
                reservation: decision.reservation,
                type: 'resolution',
                depositForfeit: decision.depositForfeit, // same amount, no money moves
                report: { message: 'No dispute within 7 days, the decision is final.', date: disputeDeadline(decision) },
            });
        } catch (error) {
            if (!isDuplicateStep(error)) throw error; // someone else saved it a moment ago: fine
        }
    }
}

// Loads a case from its case number (the id of the lender's report). Returns null if it isn't one.
// The case's status is the newest step's type.
export async function loadCase(caseNumber) {
    const report = await DamageReport.findOne({ _id: caseNumber, type: 'report' });
    if (!report) return null;

    await closeExpiredDecisions(report.reservation);

    const reservation = await Reservation.findById(report.reservation).populate('item', 'name');
    if (!reservation) return null;

    const steps = await DamageReport.find({ reservation: report.reservation }).sort({ createdAt: 1 });
    return {
        report,
        reservation,
        steps,
        decision: steps.find((step) => step.type === 'decision'),
        status: steps.at(-1).type,
    };
}

// The account was deleted: throw, so the transaction rolls back and no Payment says the money moved.
function throwIfNoUser(result, username) {
    if (result.matchedCount === 0) {
        const error = new Error(`User ${username} not found`);
        error.status = 404;
        throw error;
    }
}

// payment = { type, reservation, session }: the Payment type ('deposit-forfeit' | 'deposit-refund'), the reservation id and the transaction
export async function addMoney(username, amount, { type, reservation, session }) {
    if (amount === 0) return;
    const result = await User.updateOne({ _id: username }, { $inc: { wallet: amount } }, { session });
    throwIfNoUser(result, username);
    // create() needs an array when options like { session } are passed
    await Payment.create([{
        user: username, reservation, type, amount, direction: 'receive', method: 'wallet',
    }], { session });
}

// Takes money from a wallet. The wallet may go below 0: the negative balance is what they still owe.
// Otherwise a payer who already spent their wallet would leave the case stuck as disputed forever.
// Anything that spends wallet money later must check wallet >= price, so a debt can't be spent.
export async function takeMoney(username, amount, { type, reservation, session }) {
    if (amount === 0) return;
    const result = await User.updateOne({ _id: username }, { $inc: { wallet: -amount } }, { session });
    throwIfNoUser(result, username);
    await Payment.create([{
        user: username, reservation, type, amount, direction: 'deduct', method: 'wallet',
    }], { session });
}
