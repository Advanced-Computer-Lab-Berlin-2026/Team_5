import mongoose from 'mongoose';
import joi from 'joi';
import { Item } from '../models/Item.js';
import { RefreshSession } from '../models/RefreshSession.js';
import { Referral } from '../models/Referral.js';
import { Report } from '../models/Report.js';
import { User } from '../models/User.js';
import { deleteUserAccount } from '../services/userAccountService.js';
import { Reservation, DamageReport, MembershipTier } from '../models/index.js';
import { sendCsv, sendPdf } from '../services/reportExport.js';
import { closeExpiredDecisions } from '../services/damageCase.js';

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

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_REGEX_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

// Reservations the lender confirmed. Pending, cancelled and rejected ones were never used.
const USAGE_STATUSES = ['upcoming', 'active', 'completed'];

// report -> decision (admin) -> dispute (borrower) -> resolution (final outcome)
const DAMAGE_STATUSES = ['pending-review', 'decided', 'disputed', 'resolved'];
const STATUS_BY_STEP = { report: 'pending-review', decision: 'decided', dispute: 'disputed', resolution: 'resolved' };

const usageReportSchema = joi.object({
    month: joi.string().pattern(MONTH_REGEX_PATTERN).messages({
        'string.pattern.base': 'Month must use the YYYY-MM format'
    }),
    from: joi.date().iso(),
    to: joi.date().iso().min(joi.ref('from')),
    item: joi.string().trim(),
    category: joi.string().trim()
}).with('from', 'to').with('to', 'from').oxor('month', 'from');

const damageReportSchema = joi.object({
    status: joi.string().valid(...DAMAGE_STATUSES)
});

const exportFormat = { format: joi.string().valid('csv', 'pdf').required() };
const usageExportSchema = usageReportSchema.keys(exportFormat);
const damageExportSchema = damageReportSchema.keys(exportFormat);

const USAGE_CATEGORY_COLUMNS = [
    { label: 'Category', value: row => row.category },
    { label: 'Items used', value: row => row.items },
    { label: 'Reservations', value: row => row.reservations },
    { label: 'Days reserved', value: row => row.daysReserved },
    { label: 'Deposits', value: row => row.deposits }
];

const USAGE_ITEM_COLUMNS = [
    { label: 'Item ID', value: row => row.itemId },
    { label: 'Item', value: row => row.name },
    { label: 'Category', value: row => row.category },
    { label: 'Reservations', value: row => row.reservations },
    { label: 'Days reserved', value: row => row.daysReserved },
    { label: 'Deposits', value: row => row.deposits }
];

const DAMAGE_COLUMNS = [
    { label: 'Reservation', value: row => row.reservation },
    { label: 'Item', value: row => row.item?.name },
    { label: 'Borrower', value: row => row.borrower },
    { label: 'Lender', value: row => row.lender },
    { label: 'Status', value: row => row.status },
    { label: 'Disputed', value: row => (row.disputed ? 'Yes' : 'No') },
    { label: 'Deposit', value: row => row.depositAmount },
    { label: 'Forfeited', value: row => row.depositForfeit },
    { label: 'Opened', value: row => toDateString(row.openedAt) },
    { label: 'Last update', value: row => toDateString(row.lastUpdatedAt) }
];

function toDateString(date) {
    return date ? new Date(date).toISOString().slice(0, 10) : '';
}

// Returns a percentage with one decimal, e.g. 12.5
export function toPercent(part, whole) {
    return whole ? Math.round((part / whole) * 1000) / 10 : 0;
}

// Either an explicit from/to range (both inclusive) or one month, the current month by default.
// end is exclusive so the query can use $lt
function getUsagePeriod(value) {
    if (value.from) {
        return {
            start: value.from,
            end: new Date(value.to.getTime() + DAY_MS),
            label: `${toDateString(value.from)} to ${toDateString(value.to)}`
        };
    }

    const month = value.month ?? new Date().toISOString().slice(0, 7);
    const [year, monthNumber] = month.split('-').map(Number);
    return {
        start: new Date(Date.UTC(year, monthNumber - 1, 1)),
        end: new Date(Date.UTC(year, monthNumber, 1)),
        label: month
    };
}

function groupByCategory(items) {
    const categories = new Map();
    for (const item of items) {
        const entry = categories.get(item.category)
            ?? { category: item.category, items: 0, reservations: 0, daysReserved: 0, deposits: 0 };
        entry.items += 1;
        entry.reservations += item.reservations;
        entry.daysReserved += item.daysReserved;
        entry.deposits += item.deposits;
        categories.set(item.category, entry);
    }
    return [...categories.values()].sort((a, b) => b.reservations - a.reservations);
}

async function buildUsageReport(value) {
    const period = getUsagePeriod(value);

    const match = { startDate: { $gte: period.start, $lt: period.end }, status: { $in: USAGE_STATUSES } };
    if (value.item) match.item = value.item;

    const items = await Reservation.aggregate([
        { $match: match },
        { $lookup: { from: 'items', localField: 'item', foreignField: '_id', as: 'itemDoc' } },
        { $unwind: '$itemDoc' },
        ...(value.category ? [{ $match: { 'itemDoc.category': value.category } }] : []),
        {
            $group: {
                _id: '$item',
                name: { $first: '$itemDoc.name' },
                category: { $first: '$itemDoc.category' },
                reservations: { $sum: 1 },
                daysReserved: { $sum: { $dateDiff: { startDate: '$startDate', endDate: '$endDate', unit: 'day' } } },
                deposits: { $sum: '$payment.depositAmount' }
            }
        },
        { $sort: { reservations: -1, name: 1 } },
        { $project: { _id: 0, itemId: '$_id', name: 1, category: 1, reservations: 1, daysReserved: 1, deposits: 1 } }
    ]);

    const categories = groupByCategory(items);
    return {
        period: { label: period.label, start: period.start, end: period.end },
        filters: { item: value.item ?? null, category: value.category ?? null },
        totals: {
            reservations: items.reduce((sum, item) => sum + item.reservations, 0),
            items: items.length,
            categories: categories.length
        },
        categories,
        items
    };
}

function getResolutionStatus(entries) {
    return STATUS_BY_STEP[entries.at(-1).type];
}

// The case number used in /api/admin/damage-reports/:id is the id of the lender's report
function getCaseNumber(entries) {
    return entries.find(entry => entry.type === 'report')?._id ?? null;
}

// One case per reservation, built from all of its report, decision, dispute and resolution entries
function toDamageCase(reservationId, entries, reservation) {
    const { item, borrower, lender, payment } = reservation ?? {};
    const latestRuling = entries.findLast(entry => ['decision', 'resolution'].includes(entry.type));
    return {
        id: getCaseNumber(entries),
        reservation: reservationId,
        item: item ? { id: item._id, name: item.name, category: item.category } : null,
        borrower: borrower ?? null,
        lender: lender ?? null,
        depositAmount: payment?.depositAmount ?? null,
        status: getResolutionStatus(entries),
        disputed: entries.some(entry => entry.type === 'dispute'),
        depositForfeit: latestRuling?.depositForfeit ?? null,
        openedAt: entries[0].createdAt,
        lastUpdatedAt: entries.at(-1).createdAt,
        history: entries.map(entry => ({
            id: entry._id,
            type: entry.type,
            returnCondition: entry.returnCondition,
            message: entry.report?.message,
            depositForfeit: entry.depositForfeit,
            date: entry.createdAt
        }))
    };
}

async function buildDamageReport(value) {
    // decisions nobody disputed within 7 days get their resolution first, so they show as resolved
    await closeExpiredDecisions();

    // Photos are left out on purpose, the admin opens them from the damage report itself
    const entries = await DamageReport.find({}).select('-report.photos').sort({ createdAt: 1 }).lean();

    const entriesByReservation = new Map();
    for (const entry of entries) {
        const list = entriesByReservation.get(entry.reservation) ?? [];
        list.push(entry);
        entriesByReservation.set(entry.reservation, list);
    }

    const reservations = await Reservation.find({ _id: { $in: [...entriesByReservation.keys()] } })
        .select('item borrower lender payment.depositAmount')
        .populate('item', 'name category')
        .lean();
    const reservationById = new Map(reservations.map(reservation => [reservation._id, reservation]));

    const cases = [...entriesByReservation].map(([reservationId, list]) =>
        toDamageCase(reservationId, list, reservationById.get(reservationId))
    ).sort((a, b) => b.openedAt - a.openedAt);

    const summary = Object.fromEntries(DAMAGE_STATUSES.map(status => [status, 0]));
    for (const damageCase of cases) summary[damageCase.status] += 1;

    return {
        summary: { total: cases.length, ...summary },
        filters: { status: value.status ?? null },
        cases: value.status ? cases.filter(damageCase => damageCase.status === value.status) : cases
    };
}

// GET /api/admin/reports/usage?month=YYYY-MM | from=YYYY-MM-DD&to=YYYY-MM-DD [&item=] [&category=]
export async function getUsageReport(req, res, next) {
    const { value, error } = usageReportSchema.validate(req.query ?? {});
    if (error) return res.status(400).json({ message: error.message });

    try {
        const report = await buildUsageReport(value);
        return res.status(200).json({ report });
    } catch (error) {
        next(error);
    }
}

// GET /api/admin/reports/usage/export?format=csv|pdf (+ the same filters as the usage report)
export async function exportUsageReport(req, res, next) {
    const { value, error } = usageExportSchema.validate(req.query ?? {});
    if (error) return res.status(400).json({ message: error.message });

    try {
        const report = await buildUsageReport(value);
        const filename = `usage-report-${report.period.label.replace(/ /g, '')}`;
        if (value.format === 'csv') return sendCsv(res, filename, USAGE_ITEM_COLUMNS, report.items);

        return sendPdf(res, filename, {
            title: 'Usage report',
            subtitle: `Period: ${report.period.label}  |  Reservations: ${report.totals.reservations}`,
            tables: [
                { heading: 'Per category', columns: USAGE_CATEGORY_COLUMNS, rows: report.categories },
                { heading: 'Per item', columns: USAGE_ITEM_COLUMNS, rows: report.items }
            ]
        });
    } catch (error) {
        next(error);
    }
}

// GET /api/admin/reports/damage [?status=pending-review|decided|disputed|resolved]
export async function getDamageReport(req, res, next) {
    const { value, error } = damageReportSchema.validate(req.query ?? {});
    if (error) return res.status(400).json({ message: error.message });

    try {
        const report = await buildDamageReport(value);
        return res.status(200).json({ report });
    } catch (error) {
        next(error);
    }
}

// GET /api/admin/reports/damage/export?format=csv|pdf [&status=]
export async function exportDamageReport(req, res, next) {
    const { value, error } = damageExportSchema.validate(req.query ?? {});
    if (error) return res.status(400).json({ message: error.message });

    try {
        const report = await buildDamageReport(value);
        const filename = `damage-report-${toDateString(new Date())}`;
        if (value.format === 'csv') return sendCsv(res, filename, DAMAGE_COLUMNS, report.cases);

        const { total, ...byStatus } = report.summary;
        const counts = Object.entries(byStatus).map(([status, count]) => `${status}: ${count}`).join(', ');
        return sendPdf(res, filename, {
            title: 'Damage reports and disputes',
            subtitle: `Total cases: ${total}  |  ${counts}`,
            tables: [{ heading: 'Cases', columns: DAMAGE_COLUMNS, rows: report.cases }]
        });
    } catch (error) {
        next(error);
    }
}

// GET /api/admin/reports/referrals
export async function getReferralReport(req, res, next) {
    try {
        const [summary] = await Referral.aggregate([
            { $match: { status: { $in: ['sent', 'converted'] } } },
            {
                $group: {
                    _id: null,
                    referralsSent: { $sum: 1 },
                    referralsConverted: { $sum: { $cond: [{ $eq: ['$status', 'converted'] }, 1, 0] } },
                    creditsIssued: { $sum: { $cond: [{ $eq: ['$status', 'converted'] }, '$creditsIssued', 0] } }
                }
            },
            { $project: { _id: 0 } }
        ]);

        return res.status(200).json({ summary: summary ?? {
            referralsSent: 0,
            referralsConverted: 0,
            creditsIssued: 0
        } });
    } catch (error) {
        next(error);
    }
}

// GET /api/admin/reports/membership-tiers
export async function getTierDistribution(req, res, next) {
    try {
        const [tiers, counts] = await Promise.all([
            MembershipTier.find({}).sort({ annual_fee: 1 }).lean(),
            User.aggregate([
                { $match: { role: { $in: ['member', 'lender'] } } },
                { $group: { _id: { $ifNull: ['$membership.tier', 'Basic'] }, members: { $sum: 1 } } }
            ])
        ]);

        const membersByTier = new Map(counts.map(count => [count._id, count.members]));
        const totalMembers = counts.reduce((sum, count) => sum + count.members, 0);

        const distribution = tiers.map(tier => ({
            tier: tier.tier,
            annualFee: tier.annual_fee,
            depositDiscount: tier.deposit_discount,
            members: membersByTier.get(tier.tier) ?? 0
        }));
        // Users can point to a tier that was removed from the tiers collection, still count them
        for (const [tier, members] of membersByTier) {
            if (!tiers.some(known => known.tier === tier)) distribution.push({ tier, annualFee: null, depositDiscount: null, members });
        }
        for (const entry of distribution) entry.percentage = toPercent(entry.members, totalMembers);

        return res.status(200).json({ totalMembers, tiers: distribution });
    } catch (error) {
        next(error);
    }
}
