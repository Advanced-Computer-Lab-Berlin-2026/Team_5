import { User } from '../models/index.js';
import { uploadToCloudinary, deleteFromCloudinary } from '../config/cloudinary.js';

const SLOTS = ['id', 'addressProof'];
// A member can change the documents until the request is submitted, and again after a rejection.
const EDITABLE = ['none', 'rejected', 'retry'];
const ALREADY_SUBMITTED = "Your request was already submitted and can no longer be changed";

// GET /api/lender-requests
export async function getMyRequest(req, res, next) {
    try {
        const user = await User.findById(req.user.id);
        res.status(200).json(user.verification);
    } catch (error) {
        next(error);
    }
}

// POST /api/lender-requests/documents/:slot
export async function uploadDocument(req, res, next) {
    let uploaded;
    try {
        if (!req.file) return res.status(400).json({ message: "Please choose a file to upload" });
        if (!SLOTS.includes(req.params.slot)) return res.status(400).json({ message: "Invalid document slot" });

        const user = await User.findById(req.user.id);
        if (!EDITABLE.includes(user.verification.status)) return res.status(409).json({ message: ALREADY_SUBMITTED });

        uploaded = await uploadToCloudinary(req.file.buffer);
        const oldFile = findDocument(user, req.params.slot)?.storedName;
        user.verification.documents = [
            ...otherDocuments(user, req.params.slot),
            {
                type: req.params.slot,
                file: { url: uploaded.secure_url },
                originalName: req.file.originalname,
                storedName: uploaded.public_id,
                docType: req.file.mimetype,
                size: req.file.size
            }
        ];
        await user.save();
        if (oldFile) await deleteStoredFile(oldFile);

        res.status(200).json(user.verification);
    } catch (error) {
        // the file reached Cloudinary but the user was not saved, so remove it again
        if (uploaded) await deleteStoredFile(uploaded.public_id);
        next(error);
    }
}

// DELETE /api/lender-requests/documents/:slot
export async function removeDocument(req, res, next) {
    try {
        if (!SLOTS.includes(req.params.slot)) return res.status(400).json({ message: "Invalid document slot" });

        const user = await User.findById(req.user.id);
        const document = findDocument(user, req.params.slot);
        if (!document) return res.status(404).json({ message: "No document uploaded in this slot" });
        if (!EDITABLE.includes(user.verification.status)) return res.status(409).json({ message: ALREADY_SUBMITTED });

        const { storedName } = document;
        user.verification.documents = otherDocuments(user, req.params.slot);
        await user.save();
        await deleteStoredFile(storedName);

        res.status(200).json(user.verification);
    } catch (error) {
        next(error);
    }
}

// POST /api/lender-requests/submit
export async function submitRequest(req, res, next) {
    try {
        const user = await User.findById(req.user.id);
        if (!EDITABLE.includes(user.verification.status)) return res.status(409).json({ message: "Your request was already submitted" });

        const hasId = findDocument(user, 'id');
        const hasAddressProof = findDocument(user, 'addressProof');
        if (!hasId && !hasAddressProof) return res.status(400).json({ message: "Please upload your ID document and proof of address" });
        if (!hasId) return res.status(400).json({ message: "Please upload your ID document" });
        if (!hasAddressProof) return res.status(400).json({ message: "Please upload your proof of address" });

        // a new submission clears the result of an earlier review
        user.verification.status = 'pending';
        user.verification.submittedAt = new Date();
        user.verification.note = undefined;
        user.verification.reviewedBy = undefined;
        user.verification.reviewedAt = undefined;
        await user.save();

        res.status(200).json(user.verification);
    } catch (error) {
        next(error);
    }
}

function findDocument(user, slot) {
    return user.verification.documents.find((document) => document.type === slot);
}

function otherDocuments(user, slot) {
    return user.verification.documents.filter((document) => document.type !== slot);
}

async function deleteStoredFile(storedName) {
    try {
        await deleteFromCloudinary(storedName);
    } catch (error) {
        console.error("Could not delete file:", error.message);
    }
}
