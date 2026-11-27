import joi from 'joi';
import { User, Item, Reservation } from '../models/index.js';

const ITEM_ID_PATTERN = /^ITM-[0-9a-f]{8}$/;

// DELETE /api/borrow-list/:itemId
export async function removeFromBorrowList(req, res, next) {
    try {
        const userId = req.user?.id;
        const { itemId } = req.params;

        if (!ITEM_ID_PATTERN.test(itemId)) {
            return res.status(400).json({ message: 'Invalid item id' });
        }

        const result = await User.updateOne(
            { _id: userId },
            { $pull: { borrow_list: { item: itemId } } }
        );

        if (result.matchedCount === 0) {
            return res.status(401).json({ message: 'User not found' });
        }
        if (result.modifiedCount === 0) {
            return res.status(404).json({ message: 'Item not in borrow list' });
        }

        const user = await User.findById(userId)
            .select('borrow_list')
            .populate('borrow_list.item');

        return res.status(200).json({
            message: 'Item removed from borrow list',
            borrowList: user.borrow_list
        });
    } catch (error) {
        next(error);
    }
}
const ITEM_FIELDS = 'name category photos depositAmount pickup owner archived delivery';

const addToBorrowListSchema = joi.object({
    startDate: joi.date().iso().required(),
    endDate: joi.date().iso().greater(joi.ref('startDate')).required()
});

function startOfToday() {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    return today;
}

function readDates(body, schema = addToBorrowListSchema) {
    const { value, error } = schema.validate(body ?? {});
    if (error) return { message: error.message };
    if (value.startDate < startOfToday()) return { message: 'Start date cannot be in the past' };
    return { value };
}

// Archived, flagged and suspended owners' items are hidden from the catalog, so they act like they don't exist
async function findBorrowableItem(itemId) {
    const item = await Item.findOne(
        { _id: itemId, archived: false, flagged: { $ne: true } },
        'owner delivery',
        { lean: true, populate: { path: 'owner', select: 'suspended' } }
    );
    return item?.owner && !item.owner.suspended ? item : null;
}

// POST /api/borrow-list/:itemId
export async function addToBorrowList(req, res, next) {
    const { itemId } = req.params;
    if (!ITEM_ID_PATTERN.test(itemId)) return res.status(400).json({ message: 'Invalid item id' });

    const { value, message } = readDates(req.body, addToBorrowListSchema.keys({
        deliveryAddress: joi.string().trim().max(500)
    }));
    if (message) return res.status(400).json({ message });

    try {
        const userId = req.user.id;
        const item = await findBorrowableItem(itemId);
        if (!item) return res.status(404).json({ message: 'Item not found' });
        if (item.owner._id === userId) return res.status(403).json({ message: 'You cannot borrow your own item' });
        if (value.deliveryAddress && !item.delivery?.offered) return res.status(400).json({ message: 'Item does not offer delivery' });

        const overlap = await Reservation.findOverlap(itemId, value.startDate, value.endDate);
        if (overlap) return res.status(409).json({ message: 'Item is not available for these dates' });

        const entry = { item: itemId, ...value };
        // The filter and the push run as one update, so the same item can never be added twice
        const result = await User.updateOne(
            { _id: userId, 'borrow_list.item': { $ne: itemId } },
            { $push: { borrow_list: entry } }
        );
        if (result.matchedCount === 0) return res.status(409).json({ message: 'Item is already in your borrow list' });

        return res.status(201).json({ message: 'Item added to borrow list', entry });
    } catch (error) {
        next(error);
    }
}

// PATCH /api/borrow-list/:itemId
export async function updateBorrowListDates(req, res, next) {
    const { itemId } = req.params;
    if (!ITEM_ID_PATTERN.test(itemId)) return res.status(400).json({ message: 'Invalid item id' });

    const { value, message } = readDates(req.body);
    if (message) return res.status(400).json({ message });

    try {
        const userId = req.user.id;

        // Checked before the overlap so an item that isn't in the list is always a 404
        const inList = await User.exists({ _id: userId, 'borrow_list.item': itemId });
        if (!inList) return res.status(404).json({ message: 'Item not in borrow list' });

        const overlap = await Reservation.findOverlap(itemId, value.startDate, value.endDate);
        if (overlap) return res.status(409).json({ message: 'Item is not available for these dates' });

        // The positional $ operator only touches the entry the filter matched
        const result = await User.updateOne(
            { _id: userId, 'borrow_list.item': itemId },
            { $set: { 'borrow_list.$.startDate': value.startDate, 'borrow_list.$.endDate': value.endDate } }
        );
        if (result.matchedCount === 0) return res.status(404).json({ message: 'Item not in borrow list' });

        const entry = { item: itemId, startDate: value.startDate, endDate: value.endDate };
        return res.status(200).json({ message: 'Borrow list dates updated', entry });
    } catch (error) {
        next(error);
    }
}

// GET /api/borrow-list
export async function getBorrowList(req, res, next) {
    try {
        const user = await User.findById(req.user.id, 'borrow_list', {
            lean: true,
            populate: { path: 'borrow_list.item', select: ITEM_FIELDS }
        });
        if (!user) return res.status(401).json({ message: 'User not found' });

        // An item that was deleted after it was added has nothing left to borrow
        const borrowList = user.borrow_list.filter(entry => entry.item);
        return res.status(200).json({ borrowList });
    } catch (error) {
        next(error);
    }
}
