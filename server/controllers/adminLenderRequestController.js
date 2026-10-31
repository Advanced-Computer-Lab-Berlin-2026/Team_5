import joi from 'joi';
import { User } from '../models/index.js';
import { getSignedDocumentUrl } from '../config/cloudinary.js';

const SLOTS = ['id', 'addressProof'];
const STATUS = ['pending', 'accepted', 'rejected'];
const USER_FIELDS = 'username profile verification';
const NOT_FOUND = "Lender request not found";

const decisionSchema = joi.object(
    {
        decision: joi.string().valid('accept', 'reject').required(),
        reason: joi.string().trim().max(500).when('decision', { is: 'reject', then: joi.required(), otherwise: joi.forbidden() })
    }
);

// GET /api/admin/lender-requests
export async function listLenderRequests(req, res, next) {
    try {
        const status = req.query.status || 'pending';
        if (!STATUS.includes(status)) return res.status(400).json({ message: "Invalid status" });

        const users = await User.find({ 'verification.status': status }).select(USER_FIELDS).sort({ 'verification.submittedAt': -1 });
        res.status(200).json(users);
    } catch (error) {
        next(error);
    }
}

// GET /api/admin/lender-requests/:username
export async function getLenderRequest(req, res, next) {
    try {
        const user = await findApplicant(req.params.username);
        if (!user) return res.status(404).json({ message: NOT_FOUND });

        res.status(200).json(requestView(user));
    } catch (error) {
        next(error);
    }
}

// GET /api/admin/lender-requests/:username/documents/:slot
export async function getLenderRequestDocument(req, res, next) {
    try {
        if (!SLOTS.includes(req.params.slot)) return res.status(400).json({ message: "Invalid document slot" });

        const user = await findApplicant(req.params.username);
        if (!user) return res.status(404).json({ message: NOT_FOUND });

        const document = user.verification.documents.find((doc) => doc.type === req.params.slot);
        if (!document) return res.status(404).json({ message: "Document not found" });

        res.redirect(getSignedDocumentUrl(document, req.query.download === 'true'));
    } catch (error) {
        next(error);
    }
}

// PATCH /api/admin/lender-requests/:username/decision
export async function decideLenderRequest(req, res, next) {
    try {
        const { value, error } = decisionSchema.validate(req.body ?? {});
        if (error) return res.status(400).json({ message: error.message });

        const user = await findApplicant(req.params.username);
        if (!user) return res.status(404).json({ message: NOT_FOUND });
        if (user.verification.status !== 'pending') return res.status(409).json({ message: "Only pending requests can be accepted or rejected" });

        if (value.decision === 'accept') user.role = 'lender';
        user.verification.status = value.decision === 'accept' ? 'accepted' : 'rejected';
        user.verification.note = value.reason;
        user.verification.reviewedBy = req.user.id;
        user.verification.reviewedAt = new Date();
        await user.save();

        res.status(200).json(requestView(user));
    } catch (error) {
        next(error);
    }
}

async function findApplicant(username) {
    const user = await User.findById(username);
    return user && user.verification.status !== 'none' ? user : null;
}

function requestView(user) {
    return { username: user.username, profile: user.profile, verification: user.verification };
}
