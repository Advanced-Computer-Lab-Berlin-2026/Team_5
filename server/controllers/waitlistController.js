import Joi from 'joi';
import { Item } from '../models/Item.js';
import { Reservation } from '../models/Reservation.js';
import { Waitlist } from '../models/Waitlist.js';

const ITEM_ID_PATTERN = /^ITM-[0-9a-f]{8}$/;
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
        const { itemId } = req.params;
        if (!ITEM_ID_PATTERN.test(itemId)) {
            return res.status(400).json({ message: 'Invalid item id' });
        }

        const { value, error } = joinWaitlistSchema.validate(req.body);
        if (error) return res.status(400).json({ message: error.message });

        const result = await Waitlist.deleteOne(
            {
                item: itemId,
                startDate: value.startDate,
                endDate: value.endDate,
                username: req.user.id
            }
        );

        if (!result.deletedCount) {
            return res.status(404).json({ message: 'You are not on this waitlist' });
        }

        return res.status(200).json({ message: 'Left the waitlist' });
    } catch (error) {
        next(error);
    }
}

export async function getWaitlist(req, res, next) {
    try {
        const waitlists = await Waitlist.find({ username: req.user.id }).populate('item');
        return res.status(200).json({ waitlists });
    } catch (error) {
        next(error);
    }
}