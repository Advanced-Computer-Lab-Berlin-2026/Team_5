import joi from 'joi';
import { Item } from '../models/Item.js';
import { PromoCode } from '../models/PromoCode.js';
import { PromoCodeUsage } from '../models/PromoCodeUsage.js';

const validatePromoCodeSchema = joi.object({
    code: joi.string().trim().uppercase().required(),
    itemId: joi.string().trim().required(),
});

const createPromoCodeSchema = joi.object({
    code: joi.string().trim().uppercase().pattern(/^[A-Z0-9_-]+$/).min(3).max(32).required(),
    discountPercent: joi.number().min(1).max(100).required(),
    expiresAt: joi.date().iso().greater('now').optional(),
    maxUses: joi.number().integer().min(1).optional(),
    minimumDeposit: joi.number().min(0).default(0),
});

const promoUsageQuerySchema = joi.object({
    code: joi.string().trim().uppercase(),
    from: joi.date().iso(),
    to: joi.date().iso(),
}).custom((value, helpers) => {
    if (value.from && value.to && value.from > value.to) return helpers.error('date.order');
    return value;
}).messages({ 'date.order': 'from must be earlier than or equal to to' });

function buildPromoUsageFilter(value) {
    const filter = {};
    if (value.code) filter.code = value.code;
    if (value.from || value.to) {
        filter.date = {};
        if (value.from) filter.date.$gte = value.from;
        if (value.to) filter.date.$lte = value.to;
    }
    return filter;
}

function summarizePromoUsage(redemptions) {
    const summaryByCode = new Map();
    for (const redemption of redemptions) {
        const code = redemption.code?.code ?? redemption.code;
        const summary = summaryByCode.get(code) ?? { code, redemptions: 0, discountIssued: 0 };
        summary.redemptions += 1;
        summary.discountIssued += redemption.discountAmount ?? 0;
        summaryByCode.set(code, summary);
    }
    return [...summaryByCode.values()];
}

function getPromoCodeStatus(promoCode, redemptionCount, now) {
    if (!promoCode.active) return 'inactive';
    if (promoCode.expiresAt && promoCode.expiresAt <= now) return 'expired';
    if (promoCode.maxUses !== null && promoCode.maxUses !== undefined && redemptionCount >= promoCode.maxUses) {
        return 'usage-limit-reached';
    }
    return 'active';
}

async function getPromoCodeError(promoCode) {
    if (!promoCode || !promoCode.active) return 'Promo code is invalid or inactive';
    if (promoCode.expiresAt && promoCode.expiresAt <= new Date()) return 'Promo code has expired';
    if (promoCode.maxUses === null || promoCode.maxUses === undefined) return null;

    const usageCount = await PromoCodeUsage.countDocuments({ code: promoCode._id });
    return usageCount >= promoCode.maxUses ? 'Promo code usage limit has been reached' : null;
}

// POST /api/admin/promo-codes
export async function createPromoCode(req, res, next) {
    try {
        const { value, error } = createPromoCodeSchema.validate(req.body ?? {}, { stripUnknown: true });
        if (error) return res.status(400).json({ message: error.message });

        const promoCode = await PromoCode.create({ ...value, active: true });
        return res.status(201).json({ promoCode });
    } catch (error) {
        if (error.code === 11000) return res.status(409).json({ message: 'Promo code already exists' });
        next(error);
    }
}

// GET /api/admin/promo-codes
export async function listPromoCodes(req, res, next) {
    try {
        const [promoCodes, usageCounts] = await Promise.all([
            PromoCode.find({}).sort({ createdAt: -1 }).lean(),
            PromoCodeUsage.aggregate([
                { $group: { _id: '$code', redemptions: { $sum: 1 } } },
            ]),
        ]);
        const countByCode = new Map(usageCounts.map(({ _id, redemptions }) => [_id, redemptions]));
        const now = new Date();

        return res.status(200).json({
            promoCodes: promoCodes.map((promoCode) => {
                const redemptionCount = countByCode.get(promoCode._id) ?? 0;
                return {
                    ...promoCode,
                    redemptionCount,
                    status: getPromoCodeStatus(promoCode, redemptionCount, now),
                };
            }),
        });
    } catch (error) {
        next(error);
    }
}

// GET /api/admin/promo-codes/usage
export async function getPromoCodeUsage(req, res, next) {
    try {
        const { value, error } = promoUsageQuerySchema.validate(req.query ?? {}, { stripUnknown: true });
        if (error) return res.status(400).json({ message: error.message });

        const redemptions = await PromoCodeUsage.find(buildPromoUsageFilter(value))
            .sort({ date: -1 })
            .populate('code', 'code discountPercent')
            .populate('transaction', 'amount method date type')
            .populate('user', 'username profile.name')
            .populate('reservation', 'item startDate endDate status')
            .lean();

        return res.status(200).json({
            totalRedemptions: redemptions.length,
            totalDiscountIssued: redemptions.reduce((total, redemption) => total + (redemption.discountAmount ?? 0), 0),
            summary: summarizePromoUsage(redemptions),
            redemptions,
        });
    } catch (error) {
        next(error);
    }
}

// POST /api/promo-codes/validate
export async function validatePromoCode(req, res, next) {
    try {
        const { value, error } = validatePromoCodeSchema.validate(req.body ?? {}, { stripUnknown: true });
        if (error) return res.status(400).json({ message: error.message });

        const item = await Item.findOne({ _id: value.itemId, archived: false, flagged: { $ne: true } });
        if (!item) return res.status(404).json({ message: 'Item not found' });

        const promoCode = await PromoCode.findOne({ code: value.code });
        const promoCodeError = await getPromoCodeError(promoCode);
        if (promoCodeError) return res.status(400).json({ message: promoCodeError });
        if (item.depositAmount < promoCode.minimumDeposit) {
            return res.status(400).json({ message: 'Deposit does not meet the promo code minimum' });
        }

        const originalDeposit = item.depositAmount;
        const discountAmount = Math.round(originalDeposit * promoCode.discountPercent) / 100;
        const discountedDeposit = Math.round((originalDeposit - discountAmount) * 100) / 100;

        return res.status(200).json({
            code: promoCode.code,
            discountPercent: promoCode.discountPercent,
            minimumDeposit: promoCode.minimumDeposit,
            originalDeposit,
            discountAmount,
            discountedDeposit,
        });
    } catch (error) {
        next(error);
    }
}