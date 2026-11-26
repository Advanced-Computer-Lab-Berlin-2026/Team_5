import mongoose from 'mongoose';
import joi from 'joi';
import { DamageReport } from '../models/DamageReport.js';
import { DAMAGE_REPORT_ID_PATTERN, loadCase, addMoney, takeMoney, isDuplicateStep, disputeDeadline } from '../services/damageCase.js';
import { notify } from '../services/notificationService.js';

const rulingSchema = joi.object({
    // at most 2 decimals: 33.3333 is refused (joi's own .precision(2) would silently round it instead)
    depositForfeit: joi.number().min(0).required().custom((value, helpers) => (
        /^\d+(\.\d{1,2})?$/.test(String(value)) ? value : helpers.error('number.precision', { limit: 2 })
    )),
    message: joi.string().trim().required(),
});

const DATE_FORMAT = { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Berlin' };

// Called after the commit, like the damaged-return flow: a failed notification never undoes the ruling.
// Each one catches on its own so one failure doesn't hide the other.
async function notifyBoth(reservation, subject, { borrower, lender }) {
    const send = async (username, message) => {
        try {
            await notify(username, { type: 'other', subject, reservation: reservation._id, message });
        } catch (error) {
            console.error(`failed to notify ${username} about ${subject} for ${reservation._id}`, error);
        }
    };
    await Promise.all([send(reservation.borrower, borrower), send(reservation.lender, lender)]);
}

// Checks the id and finds the case. Returns { damageCase } or { status, message } for the error response.
async function findCase(id) {
    if (!DAMAGE_REPORT_ID_PATTERN.test(id)) return { status: 400, message: 'Invalid damage report id' };
    const damageCase = await loadCase(id);
    if (!damageCase) return { status: 404, message: 'Damage case not found' };
    return { damageCase };
}

// Validates { depositForfeit, message } against the deposit. Returns { value } or { message }.
function checkRuling(body, deposit) {
    const { value, error } = rulingSchema.validate(body ?? {});
    if (error) return { message: error.message };
    if (value.depositForfeit > deposit) return { message: 'The forfeit cannot be more than the deposit' };
    return { value };
}

// GET /api/admin/damage-reports/:id
// One case: before photos (pickup), after photos (return), and every step in order.
export async function getDamageCase(req, res, next) {
    try {
        const { damageCase, status, message } = await findCase(req.params.id);
        if (!damageCase) return res.status(status).json({ message });

        res.status(200).json({
            id: damageCase.report._id,
            status: damageCase.status,
            beforePhotos: damageCase.reservation.handover?.pickupPhotos ?? [],
            afterPhotos: damageCase.reservation.handover?.returnPhotos ?? [],
            steps: damageCase.steps,
            reservation: damageCase.reservation,
        });
    } catch (error) {
        next(error);
    }
}

// POST /api/admin/damage-reports/:id/decision   { depositForfeit, message }
// First ruling. Money moves now: the forfeit to the lender, the rest back to the borrower.
export async function decideDamageCase(req, res, next) {
    let session;
    try {
        const { damageCase, status, message } = await findCase(req.params.id);
        if (!damageCase) return res.status(status).json({ message });
        if (damageCase.status !== 'report') return res.status(409).json({ message: 'This case already has a decision' });

        const { reservation } = damageCase;
        const deposit = reservation.payment.depositAmount;
        const ruling = checkRuling(req.body, deposit);
        if (!ruling.value) return res.status(400).json({ message: ruling.message });

        const toLender = ruling.value.depositForfeit;
        const toBorrower = Math.round((deposit - toLender) * 100) / 100; // cents, no float noise
        let decision;

        // the step and the money are saved together, or nothing
        session = await mongoose.startSession();
        await session.withTransaction(async () => {
            [decision] = await DamageReport.create([{
                reservation: reservation._id,
                type: 'decision',
                depositForfeit: toLender,
                report: { message: ruling.value.message },
            }], { session });
            await addMoney(reservation.lender, toLender, { type: 'deposit-forfeit', reservation: reservation._id, session });
            await addMoney(reservation.borrower, toBorrower, { type: 'deposit-refund', reservation: reservation._id, session });
        });

        const deadline = disputeDeadline(decision).toLocaleDateString('en-GB', DATE_FORMAT);
        await notifyBoth(reservation, 'Damage report decided', {
            borrower: `The admin decided on the damage report: ₥${toLender} of your deposit goes to the lender and ₥${toBorrower} was refunded to your wallet. `
                + `If you disagree, you can dispute this until ${deadline}.`,
            lender: `The admin decided on your damage report: ₥${toLender} of the deposit was added to your wallet. `
                + `The borrower can dispute this until ${deadline}.`,
        });

        res.status(201).json({ decision, toLender, toBorrower });
    } catch (error) {
        if (isDuplicateStep(error)) return res.status(409).json({ message: 'This case already has a decision' });
        next(error);
    } finally {
        await session?.endSession();
    }
}

// POST /api/admin/damage-reports/:id/resolution   { depositForfeit, message }
// Final ruling after a dispute. Only the difference to the decision moves.
// After 7 days with no dispute, loadCase has already saved the automatic resolution, so this gives 409.
export async function resolveDamageCase(req, res, next) {
    let session;
    try {
        const { damageCase, status, message } = await findCase(req.params.id);
        if (!damageCase) return res.status(status).json({ message });
        if (damageCase.status !== 'dispute') return res.status(409).json({ message: 'Only a disputed case can be resolved' });

        const { reservation, decision } = damageCase;
        const ruling = checkRuling(req.body, reservation.payment.depositAmount);
        if (!ruling.value) return res.status(400).json({ message: ruling.message });

        const finalForfeit = ruling.value.depositForfeit;
        // > 0: borrower pays more, < 0: lender gives back. Rounded to cents: 33.33 - 0.01 is 33.320000000000004 in JS
        const difference = Math.round((finalForfeit - decision.depositForfeit) * 100) / 100;
        let resolution;

        session = await mongoose.startSession();
        await session.withTransaction(async () => {
            [resolution] = await DamageReport.create([{
                reservation: reservation._id,
                type: 'resolution',
                depositForfeit: finalForfeit,
                report: { message: ruling.value.message },
            }], { session });

            if (difference > 0) {
                const payment = { type: 'deposit-forfeit', reservation: reservation._id, session };
                await takeMoney(reservation.borrower, difference, payment);
                await addMoney(reservation.lender, difference, payment);
            } else if (difference < 0) {
                const payment = { type: 'deposit-refund', reservation: reservation._id, session };
                await takeMoney(reservation.lender, -difference, payment);
                await addMoney(reservation.borrower, -difference, payment);
            }
        });

        const final = `The admin resolved the dispute: the final amount kept from the deposit is ₥${finalForfeit}.`;
        let borrower = `${final} Nothing changes in your wallet.`;
        let lender = borrower;
        if (difference > 0) {
            borrower = `${final} ₥${difference} more was taken from your wallet.`;
            lender = `${final} ₥${difference} more was added to your wallet.`;
        } else if (difference < 0) {
            borrower = `${final} ₥${-difference} was given back to your wallet.`;
            lender = `${final} ₥${-difference} was taken from your wallet and given back to the borrower.`;
        }
        await notifyBoth(reservation, 'Damage dispute resolved', { borrower, lender });

        res.status(201).json({ resolution, difference });
    } catch (error) {
        if (isDuplicateStep(error)) return res.status(409).json({ message: 'This case was already resolved' });
        next(error); // a deleted borrower/lender account arrives here with status 404
    } finally {
        await session?.endSession();
    }
}
