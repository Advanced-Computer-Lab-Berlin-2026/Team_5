import joi from 'joi';
import { DamageReport } from '../models/DamageReport.js';
import { Reservation } from '../models/Reservation.js';
import { sendPdf } from '../services/reportExport.js';
import { DAMAGE_REPORT_ID_PATTERN, loadCase, isDuplicateStep } from '../services/damageCase.js';
import { uploadPhotos, deletePhotos } from '../services/photoUpload.js';

const disputeSchema = joi.object({ message: joi.string().trim().required() });
const INVALID_ID = { message: 'Invalid damage report id' };
const NOT_FOUND = { message: 'Damage case not found' };

export async function getDamageCaseForReservation(req, res, next) {
    try {
        const { reservationId } = req.params;
        const reservation = await Reservation.exists({
            _id: reservationId, $or: [{ borrower: req.user.id }, { lender: req.user.id }]
        });
        if (!reservation) return res.status(404).json(NOT_FOUND);
        const report = await DamageReport.findOne({ reservation: reservationId, type: 'report' });
        const damageCase = report && await loadCase(report._id);
        if (!damageCase) return res.status(404).json(NOT_FOUND);
        return res.json({
            id: report._id,
            status: damageCase.status,
            canDispute: !checkCanDispute(damageCase, req.user.id),
            steps: damageCase.steps.map(step => ({
                type: step.type, message: step.report.message, depositForfeit: step.depositForfeit
            }))
        });
    } catch (error) {
        next(error);
    }
}

const toDate = (value) => new Date(value).toLocaleDateString('en-GB');

// Returns { status, message } when this user can't dispute the case, or null when they can.
function checkCanDispute(damageCase, userId) {
    // not the borrower -> the same 404 as "no case", so the case stays hidden
    if (!damageCase || damageCase.reservation.borrower !== userId) return { status: 404, message: NOT_FOUND.message };
    if (damageCase.status === 'resolution') return { status: 409, message: 'This case is already final' };
    if (damageCase.status !== 'decision') return { status: 409, message: 'You can only dispute a case after an admin decided it' };
    return null;
}

const canDownload = (user, reservation) =>
    user.role === 'admin' || user.id === reservation.borrower || user.id === reservation.lender;

// The PDF content for sendPdf: a title, a subtitle and three tables
function buildCasePdf({ report, reservation, steps, status }) {
    const handover = reservation.handover ?? {};
    return {
        title: `Damage case ${report._id}  (${status})`,
        subtitle: `${reservation.item?.name ?? 'Deleted item'} · reservation ${reservation._id}`
            + ` · borrower ${reservation.borrower} · lender ${reservation.lender}`
            + ` · deposit ${reservation.payment.depositAmount}`,
        tables: [
            {
                heading: 'Steps',
                columns: [
                    // report.date, not createdAt: an automatic resolution shows the day it became final
                    { label: 'Date', value: (step) => toDate(step.report.date) },
                    { label: 'Step', value: (step) => step.type },
                    { label: 'Kept from deposit', value: (step) => step.depositForfeit ?? '' },
                    { label: 'Photos', value: (step) => step.report.photos.length },
                ],
                rows: steps,
            },
            {
                heading: 'Messages',
                columns: [
                    { label: 'Step', value: (step) => step.type },
                    { label: 'Message', value: (step) => step.report.message },
                ],
                rows: steps,
            },
            {
                heading: 'Condition photos',
                columns: [
                    { label: 'Stage', value: (row) => row.stage },
                    { label: 'Number of photos', value: (row) => row.count },
                ],
                rows: [
                    { stage: 'Before (pickup)', count: handover.pickupPhotos?.length ?? 0 },
                    { stage: 'After (return)', count: handover.returnPhotos?.length ?? 0 },
                ],
            },
        ],
    };
}

// POST /api/damage-reports/:id/dispute   (form fields: message, and optional files in "photos")
// The borrower disagrees with the admin's decision. An admin then makes the final ruling.
export async function disputeDamageCase(req, res, next) {
    let uploaded = [];
    try {
        if (!DAMAGE_REPORT_ID_PATTERN.test(req.params.id)) return res.status(400).json(INVALID_ID);
        const { value, error } = disputeSchema.validate(req.body ?? {}, { stripUnknown: true });
        if (error) return res.status(400).json({ message: error.message });

        const damageCase = await loadCase(req.params.id); // also saves the resolution if the 7 days are over
        const refused = checkCanDispute(damageCase, req.user.id);
        if (refused) return res.status(refused.status).json({ message: refused.message });

        uploaded = await uploadPhotos(req.files ?? []);
        const dispute = await DamageReport.create({
            reservation: damageCase.reservation._id,
            type: 'dispute',
            report: { photos: uploaded.map((file) => ({ url: file.secure_url })), message: value.message },
        });

        res.status(201).json({ dispute });
    } catch (error) {
        await deletePhotos(uploaded); // don't leave unused photos in Cloudinary
        if (isDuplicateStep(error)) return res.status(409).json({ message: 'This decision was already disputed' });
        next(error);
    }
}

// GET /api/damage-reports/:id/pdf
// Downloads the case as a PDF. Only admins, and this case's borrower and lender, can get it.
export async function downloadDamageCasePdf(req, res, next) {
    try {
        if (!DAMAGE_REPORT_ID_PATTERN.test(req.params.id)) return res.status(400).json(INVALID_ID);
        const damageCase = await loadCase(req.params.id);
        // not allowed -> the same 404 as "no case", so the case stays hidden
        if (!damageCase || !canDownload(req.user, damageCase.reservation)) return res.status(404).json(NOT_FOUND);

        return sendPdf(res, `damage-case-${damageCase.report._id}`, buildCasePdf(damageCase));
    } catch (error) {
        next(error);
    }
}
