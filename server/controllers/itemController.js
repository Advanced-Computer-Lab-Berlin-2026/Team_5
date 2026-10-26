import joi from 'joi';
import { Item } from '../models/index.js';

// only the fields the list card needs, I keep the full details for the item page
const LIST_FIELDS = 'name category photos depositAmount';

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

        const filter = { archived: value.archived };
        if (value.category) filter.category = value.category;
        // I use the text index on name from the Item model here
        if (value.search) filter.$text = { $search: value.search };

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
