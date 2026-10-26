import joi from 'joi';
import { Item, User } from '../models/index.js';

// only the fields the list card needs, I keep the full details for the item page
const LIST_FIELDS = { name: 1, category: 1, photos: 1, depositAmount: 1 };

const listItemsSchema = joi.object({
    // these run in order, number then integer then min then default. I can't swap them
    page: joi.number().integer().min(1).default(1),
    limit: joi.number().integer().min(1).max(50).default(10),
    category: joi.string().trim(),
    archived: joi.boolean().default(false),
    // default false so archived drops out, thats the spec. SCRUM-298 is the ticket for keeping them out of list/search/filter
    search: joi.string().trim().max(100)
});

// GET /api/items
export async function listItems(req, res, next) {
    try {
        const { value, error } = listItemsSchema.validate(req.query);
        if (error) return res.status(400).json({ message: error.message });

        // flagged items are hidden here too, same as the details page
        const filter = { archived: value.archived, flagged: { $ne: true } };
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
            // mongoose turns this find() into a mongo query, not sql. temp so I remember
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
            { _id: req.params.id, flagged: { $ne: true } },
            { flagged: 0, __v: 0 }, // hides flagged from the response
            {
                lean: true,
                // owner is name only, lean skips User toJSON so password/email/phone/wallet must never be read. populate's select asks User lookup for just name + suspended
                populate: { path: 'owner', select: 'profile.name suspended' }
            }
        );
        // a suspended lender's item 404s like it doesn't exist, same as in the list
        if (!item || item.owner?.suspended) return res.status(404).json({ message: 'Item not found' });

        // owner is null if the user got deleted, so I don't crash on owner.profile
        // username is the login id and populate always reads _id (= username), so I rebuild owner as { name } only
        const owner = item.owner ? { name: item.owner.profile?.name } : null;

        res.status(200).json({ item: { ...item, owner } });
    } catch (error) {
        next(error);
    }
}
