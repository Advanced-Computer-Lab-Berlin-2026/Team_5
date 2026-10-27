import joi from 'joi';
import { Item, User } from '../models/index.js';

// only the fields the list card needs, I keep the full details for the item page
const LIST_FIELDS = { name: 1, category: 1, photos: 1, depositAmount: 1 };

const listItemsSchema = joi.object({
    // these run in order, number then integer then min then default. I can't swap them
    page: joi.number().integer().min(1).default(1),
    limit: joi.number().integer().min(1).max(50).default(10),
    category: joi.string().trim(),
    // no archived param, archived items never show in the list, search or filter (SCRUM-298). passing it is a 400 like any unknown param
    search: joi.string().trim().max(100)
});

// GET /api/items
export async function listItems(req, res, next) {
    try {
        const { value, error } = listItemsSchema.validate(req.query);
        if (error) return res.status(400).json({ message: error.message });

        // flagged items are hidden here too, same as the details page
        // "available" here just means not archived and not flagged. checking reservations and dates is sprint 2 (E11, SCRUM-419)
        const filter = { archived: false, flagged: { $ne: true } };
        // exact match, categories come from a dropdown. also keeps the category + archived index usable
        // an unknown category just gives an empty list, the ticket doesn't ask for an error
        if (value.category) filter.category = value.category;
        // partial match on name, case insensitive, but slower than the old text index
        // I escape the search first so things like "." or "(" are matched as normal characters, not regex
        if (value.search) {
            const escaped = value.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            filter.name = { $regex: escaped, $options: 'i' };
        }
        // suspended lenders' items act like they don't exist. I filter them in the query, not after, so total and totalPages stay right
        const suspendedOwners = await User.distinct('_id', { suspended: true });
        if (suspendedOwners.length) filter.owner = { $nin: suspendedOwners };

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
export async function getItem(req, res, next) {
    try {
        const item = await Item.findOne(
            // flagged is hidden from everyone, even from a direct link, so it looks like it doesn't exist
            // archived isn't filtered, so it still opens from a direct link
            // kept for reservation history (req 15). hiding it here too is a follow-up once that has its own endpoint, see SHARESHED-NOTES.md line 109
            { _id: req.params.id, flagged: { $ne: true } },
            { flagged: 0, __v: 0 },
            {
                lean: true,
                // owner is name + trust score only, lean skips User toJSON so password/email/phone/wallet must never be read. populate's select asks User lookup for just name + suspended + trust score
                populate: { path: 'owner', select: 'profile.name suspended trustScore' }
            }
        );
        // a suspended lender's item 404s like it doesn't exist, same as in the list
        if (!item || item.owner?.suspended) return res.status(404).json({ message: 'Item not found' });

        // owner is null if the user got deleted, so I don't crash on owner.profile
        // username is the login id and populate always reads _id (= username), so I rebuild owner as { name, trustScore } only
        // trust score is the stored 0-100 number on User, SCRUM-390 is the one that recalculates it
        const owner = item.owner ? { name: item.owner.profile?.name, trustScore: item.owner.trustScore } : null;

        res.status(200).json({ item: { ...item, owner } });
    } catch (error) {
        next(error);
    }
}
