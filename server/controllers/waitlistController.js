import Joi from 'joi';
import { Item } from '../models/Item.js';
import { Reservation } from '../models/Reservation.js';
import { Waitlist } from '../models/Waitlist.js';
import { promoteWaitlistAfterCancellation } from '../services/waitlistPromotion.js';
import { getWaitlistHolds } from '../services/waitlistAvailability.js';

const ITEM_ID_PATTERN = /^ITM-[0-9a-f]{8}$/;
const WAITLIST_ID_PATTERN = /^WTL-[0-9a-f]{8}$/;
const joinWaitlistSchema = Joi.object({
    startDate: Joi.date().iso().required(),
    endDate: Joi.date().iso().greater(Joi.ref('startDate')).required()
});

export async function joinWaitlist(req, res, next) {
    try {
        const { itemId } = req.params;
        if (!ITEM_ID_PATTERN.test(itemId)) {
            return res.status(400).json({ message: 'Invalid item id' });
        }

        const { value, error } = joinWaitlistSchema.validate(req.body);
        if (error) return res.status(400).json({ message: error.message });

        const item = await Item.findById(itemId);
        if (!item) return res.status(404).json({ message: 'Item not found' });
        if (item.owner === req.user.id) return res.status(403).json({ message: 'You cannot join the waitlist for your own item.' });

        const reservation = await Reservation.findOverlap(itemId, value.startDate, value.endDate);
        if (!reservation) {
            return res.status(409).json({
                error: 'ITEM_NOT_FULLY_BOOKED',
                message: 'Cannot join the waitlist: no active reservation overlaps these dates'
            });
        }

        try {
            await Waitlist.create({
                item: itemId,
                startDate: value.startDate,
                endDate: value.endDate,
                username: req.user.id
            });
        } catch (error) {
            if (error.code === 11000) {
                return res.status(409).json({ message: 'You have already joined this waitlist' });
            }
            throw error;
        }

        return res.status(201).json({ message: 'Joined the waitlist' });
    } catch (error) {
        next(error);
    }
}

export async function leaveWaitlist(req, res, next) {
    try {
        const { id } = req.params;
        const byItem = ITEM_ID_PATTERN.test(id);
        if (!byItem && !WAITLIST_ID_PATTERN.test(id)) {
            return res.status(400).json({ message: 'Invalid waitlist id' });
        }

        const filter = { ...(byItem ? { item: id } : { _id: id }), username: req.user.id };
        const entries = await Waitlist.find(filter, { item: 1, startDate: 1, endDate: 1 }, { lean: true });
        const result = byItem ? await Waitlist.deleteMany(filter) : await Waitlist.deleteOne(filter);

        if (!result.deletedCount) {
            return res.status(404).json({ message: 'You are not on this waitlist' });
        }

        for (const entry of entries) {
            try {
                await promoteWaitlistAfterCancellation(entry);
            } catch (error) {
                console.error(`Failed to notify the next waitlist member for ${entry.item}`, error);
            }
        }
        return res.status(200).json({ message: 'Left the waitlist' });
    } catch (error) {
        next(error);
    }
}

export async function getWaitlist(req, res, next) {
    try {
        const waitlists = await Waitlist.find({ username: req.user.id }).populate('item').lean();
        const items = new Map(waitlists.filter(entry => entry.item).map(entry => [entry.item._id, entry.item]));
        const eligible = await Promise.all([...items.values()].map(item =>
            item.archived || item.flagged ? [] : getWaitlistHolds(item._id, { owner: item.owner })
        ));
        const heldIds = new Set(eligible.flat().map(entry => entry._id));
        return res.status(200).json({ waitlists: waitlists.map(entry => ({ ...entry, canReserve: heldIds.has(entry._id) })) });
    } catch (error) {
        next(error);
    }
}
