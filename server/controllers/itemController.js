import joi from 'joi';
import { Item } from '../models/index.js';
import { Reservation, BLOCKING_STATUSES } from '../models/index.js'
import { getSignedManualUrl } from '../services/itemManualStorage.js';
import { availabilityDates, findBookedItemIds, getPublicItemFilter } from '../services/catalogAvailability.js';
import { getWaitlistHolds } from '../services/waitlistAvailability.js';

// only the fields the list card needs, I keep the full details for the item page
const LIST_FIELDS = { name: 1, category: 1, photos: 1, depositAmount: 1 };

// same visibility as the details page: not flagged, suspended owner looks missing
async function findVisibleItem(id, projection) {
    const item = await Item.findOne(
        { _id: id, flagged: { $ne: true } },
        projection,
        {
            lean: true,
            populate: { path: 'owner', select: 'profile.name suspended trustScore' }
        }
    );
    if (!item || item.owner?.suspended) return null;
    return item;
}

const listItemsSchema = joi.object({
    // these run in order, number then integer then min then default. I can't swap them
    page: joi.number().integer().min(1).default(1),
    limit: joi.number().integer().min(1).max(50).default(10),
    category: joi.string().trim(),
    // no archived param, archived items never show in the list, search or filter (SCRUM-298). passing it is a 400 like any unknown param
    search: joi.string().trim().max(100),
    ...availabilityDates
}).and('startDate', 'endDate');


// GET /api/items
export async function listItems(req, res, next) {
    try {
        const { value, error } = listItemsSchema.validate(req.query);
        if (error) return res.status(400).json({ message: error.message });

        // flagged items are hidden here too, same as the details page
        // "available" means not archived and not flagged, and with startDate/endDate also not booked for those dates

        const filter = await getPublicItemFilter();
        // exact match, categories come from a dropdown. also keeps the category + archived index usable
        // an unknown category just gives an empty list, the ticket doesn't ask for an error
        if (value.category) filter.category = value.category;
        // partial match on name, case insensitive, but slower than the old text index
        // I escape the search first so things like "." or "(" are matched as normal characters, not regex
        if (value.search) {
            const escaped = value.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            filter.name = { $regex: escaped, $options: 'i' };
        }
        // Same overlap rule as Reservation.findOverlap, so an item shown as available can really be reserved
        if (value.startDate) {
            const bookedItems = await findBookedItemIds(value.startDate, value.endDate, req.catalogViewerId);
            if (bookedItems.length) filter._id = { $nin: bookedItems };
        }


        const [items, total] = await Promise.all([
            Item.find(filter, LIST_FIELDS, {
                // ID acts as a second sorter in case two items are created at the same exact moment to ensure consistency when sorting
                sort: { createdAt: -1, _id: 1 },
                skip: (value.page - 1) * value.limit,
                limit: value.limit,
                lean: true
            }),
            Item.countDocuments(filter)
        ]);

        res.status(200).json({
            items,
            pagination: {
                total,
                page: value.page,
                totalPages: Math.ceil(total / value.limit),
                limit: value.limit
            }
        });
    } catch (error) {
        next(error);
    }
}

// GET /api/items/:id
// flagged is hidden from everyone; archived still opens from a direct link for reservation history
export async function getItem(req, res, next) {
    try {
        const item = await findVisibleItem(req.params.id, { flagged: 0, __v: 0 });
        if (!item) return res.status(404).json({ message: 'Item not found' });

        // owner is null if the user got deleted, so I don't crash on owner.profile
        // username is the login id and populate always reads _id (= username), so I rebuild owner as { name, trustScore } only
        const owner = item.owner ? { name: item.owner.profile?.name, trustScore: item.owner.trustScore } : null;

        res.status(200).json({ item: { ...item, owner } });
    } catch (error) {
        next(error);
    }
}

// GET /api/items/:id/calendar
export async function getItemCalendar(req, res, next) {
    try {

        // firstly we check if item id is valid regex
        if (!req.params.id.match(/^ITM-[0-9a-f]{8}$/)) {
            return res.status(400).json({ message: 'Invalid item id' });
        }

        // then we check if item exists and is not flagged
        const item = await Item.findOne(
            { _id: req.params.id, flagged: { $ne: true } },
            { flagged: 0, __v: 0 },
            {lean: true,
                // owner is name + trust score only, lean skips User toJSON so password/email/phone/wallet must never be read. populate's select asks User lookup for just name + suspended + trust score
                populate: { path: 'owner', select: 'profile.name suspended trustScore' }
            }
        );
        if (!item || item.owner?.suspended) return res.status(404).json({ message: 'Item not found' });

        // then we check if there are any reservations for this item, and sort by startDate, only return start and end date
        const reservations = await Reservation.find(
            { item: req.params.id, status: { $in: BLOCKING_STATUSES } },
            { startDate: 1, endDate: 1, _id: 0 },
            { sort: { startDate: 1 } }
        ).lean();

        const holds = await getWaitlistHolds(item._id, { reservations, owner: item.owner?._id });
        const waitlistHolds = holds.filter(hold => hold.username !== req.user.id)
            .map(({ startDate, endDate }) => ({ startDate, endDate }));
        res.status(200).json({ reservations, waitlistHolds });
    } catch (error) {
        next(error);
    }
}

// GET /api/items/:id/manual — public like item details; signed because Cloudinary manuals are authenticated
export async function getItemManual(req, res, next) {
    try {
        // owner:1 so populate can still check suspended; documents is what we need for "has manual"
        const item = await findVisibleItem(req.params.id, { documents: 1, owner: 1 });
        if (!item) return res.status(404).json({ message: 'Item not found' });
        if (!item.documents?.length) return res.status(404).json({ message: 'Manual not found' });

        res.redirect(getSignedManualUrl(item._id, { download: req.query.download === 'true' }));
    } catch (error) {
        next(error);
    }
}
