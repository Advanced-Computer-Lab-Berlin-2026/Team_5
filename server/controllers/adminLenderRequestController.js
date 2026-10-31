import mongoose from 'mongoose';
import joi from 'joi';
import { LenderRequest, User } from '../models/index.js';
import { getSignedDocumentUrl } from '../config/cloudinary.js';

const SLOTS = ['idDocument', 'proofOfAddress'];
const STATUS = ['pending', 'approved', 'rejected'];
const USER_FIELDS = 'username profile';

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

        const requests = await LenderRequest.find({ status }).populate('user', USER_FIELDS).sort({ createdAt: -1 });
        res.status(200).json(requests);
    } catch (error) {
        next(error);
    }
}

// GET /api/admin/lender-requests/:id
export async function getLenderRequest(req, res, next) {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid request id" });

        const request = await LenderRequest.findById(req.params.id).populate('user', USER_FIELDS);
        if (!request) return res.status(404).json({ message: "Lender request not found" });

        res.status(200).json(request);
    } catch (error) {
        next(error);
    }
}

// GET /api/admin/lender-requests/:id/documents/:slot
export async function getLenderRequestDocument(req, res, next) {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid request id" });
        if (!SLOTS.includes(req.params.slot)) return res.status(400).json({ message: "Invalid document slot" });

        const request = await LenderRequest.findById(req.params.id);
        if (!request) return res.status(404).json({ message: "Lender request not found" });

        const document = request[req.params.slot];
        if (!document) return res.status(404).json({ message: "Document not found" });

        
        res.redirect(getSignedDocumentUrl(document, req.query.download === 'true'));
    } catch (error) {
        next(error);
    }
}

// PATCH /api/admin/lender-requests/:id/decision
export async function decideLenderRequest(req, res, next) {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid request id" });

        const { value, error } = decisionSchema.validate(req.body ?? {});
        if (error) return res.status(400).json({ message: error.message });

        const request = await LenderRequest.findById(req.params.id);
        if (!request) return res.status(404).json({ message: "Lender request not found" });
        if (request.status !== 'pending') return res.status(409).json({ message: "Only pending requests can be accepted or rejected" });

        request.status = value.decision === 'accept' ? 'approved' : 'rejected';
        request.rejectionReason = value.reason;
        request.reviewedBy = req.user.id;
        request.reviewedAt = new Date();
        await request.save();
        await User.findByIdAndUpdate(request.user, userChangesFor(value));

        res.status(200).json(request);
    } catch (error) {
        next(error);
    }
}


function userChangesFor({ decision, reason }) {
    if (decision === 'accept') return { role: 'lender', 'verification.status': 'accepted' };
    return { 'verification.status': 'rejected', 'verification.note': reason };
}
