import mongoose from 'mongoose';
import joi from 'joi';
import { Item } from '../models/Item.js';
import { RefreshSession } from '../models/RefreshSession.js';
import { Report } from '../models/Report.js';
import { User } from '../models/User.js';
import { deleteUserAccount } from '../services/userAccountService.js';

const submitReportSchema = joi.object({
    targetType: joi.string().valid('item', 'user').required(),
    targetId: joi.string().trim().required(),
    reason: joi.string().trim().min(5).max(500).required(),
});

const decisionSchema = joi.object({
    action: joi.string().valid('flag', 'remove', 'dismiss').required(),
});

const REPORT_STATUSES = ['open', 'flagged', 'removed', 'dismissed'];
const DECISION_STATUSES = { flag: 'flagged', remove: 'removed', dismiss: 'dismissed' };

async function applyItemDecision(report, action, session) {
    const update = action === 'remove'
        ? { $set: { flagged: true, archived: true } }
        : { $set: { flagged: true } };
    const item = await Item.findOneAndUpdate(
        { _id: report.targetItem }, update, { new: true, session }
    );
    if (!item) throw Object.assign(new Error('Reported item not found'), { status: 404 });
}

async function applyUserDecision(report, action, session) {
    const user = await User.findById(report.targetUser, null, { session });
    if (!user) throw Object.assign(new Error('Reported user not found'), { status: 404 });
    if (user.role === 'admin') throw Object.assign(new Error('Admin accounts cannot be moderated through reports'), { status: 403 });

    if (action === 'remove') {
        const deleted = await deleteUserAccount(user._id, session);
        if (!deleted) throw Object.assign(new Error('Reported user not found'), { status: 404 });
        return;
    }

    user.suspended = true;
    await user.save({ session });
    await RefreshSession.deleteMany({ userId: user._id }, { session });
}

// POST /api/reports
export async function submitReport(req, res, next) {
    try {
        const { value, error } = submitReportSchema.validate(req.body ?? {}, { stripUnknown: true });
        if (error) return res.status(400).json({ message: error.message });

        const target = value.targetType === 'item'
            ? await Item.findById(value.targetId)
            : await User.findById(value.targetId);
        if (!target) return res.status(404).json({ message: `${value.targetType} not found` });

        const report = await Report.create({
            reporter: req.user.id,
            targetType: value.targetType,
            ...(value.targetType === 'item' ? { targetItem: target._id } : { targetUser: target._id }),
            reason: value.reason,
        });

        res.status(201).json({ report });
    } catch (error) {
        next(error);
    }
}

// GET /api/admin/reports?status=open
export async function listReports(req, res, next) {
    try {
        const status = req.query.status ?? 'open';
        if (status !== 'all' && !REPORT_STATUSES.includes(status)) {
            return res.status(400).json({ message: 'Status must be open, flagged, removed, dismissed, or all' });
        }

        const filter = status === 'all' ? {} : { status };
        const reports = await Report.find(filter)
            .sort({ createdAt: 1 })
            .populate('reporter', 'username profile.name')
            .populate('targetItem', 'name owner flagged archived')
            .populate('targetUser', 'username role profile.name suspended')
            .lean();

        res.status(200).json({ reports });
    } catch (error) {
        next(error);
    }
}

// PATCH /api/admin/reports/:id/decision
export async function reviewReport(req, res, next) {
    let session;
    try {
        const { value, error } = decisionSchema.validate(req.body ?? {}, { stripUnknown: true });
        if (error) return res.status(400).json({ message: error.message });

        const report = await Report.findById(req.params.id);
        if (!report) return res.status(404).json({ message: 'Report not found' });
        if (report.status !== 'open') return res.status(409).json({ message: 'Only open reports can be reviewed' });

        session = await mongoose.startSession();
        let updatedReport = null;
        await session.withTransaction(async () => {
            updatedReport = await Report.findOneAndUpdate(
                { _id: report._id, status: 'open' },
                { $set: { status: DECISION_STATUSES[value.action], reviewedBy: req.user.id } },
                { new: true, session }
            );
            if (!updatedReport || value.action === 'dismiss') return;

            if (report.targetType === 'item') {
                await applyItemDecision(report, value.action, session);
                return;
            }

            await applyUserDecision(report, value.action, session);
        });

        if (!updatedReport) return res.status(409).json({ message: 'Only open reports can be reviewed' });
        res.status(200).json({ report: updatedReport });
    } catch (error) {
        next(error);
    } finally {
        await session?.endSession();
    }
}