import { Item } from '../models/Item.js';

const ITEM_ID_PATTERN = /^ITM-[0-9a-f]{8}$/;
const ALTERNATIVE_FIELDS = { name: 1, category: 1, photos: 1, depositAmount: 1, attributes: 1 };

export async function getAlternatives(req, res, next) {
    try {
        const { itemId } = req.params;
        if (!ITEM_ID_PATTERN.test(itemId)) {
            return res.status(400).json({ message: 'Invalid item id' });
        }

        const item = await Item.findById(itemId, { category: 1, attributes: 1 }).lean();
        if (!item) return res.status(404).json({ message: 'Item not found' });

        const alternatives = await Item.find(
            {
                _id: { $ne: itemId },
                category: item.category,
                archived: false,
                flagged: { $ne: true }
            },
            ALTERNATIVE_FIELDS,
            { sort: { createdAt: -1, _id: 1 }, lean: true }
        );

        const sourceAttributes = item.attributes ?? [];
        alternatives.sort((first, second) => {
            const matches = candidate => sourceAttributes.reduce(
                (count, attribute) => count + Number(candidate.attributes?.some(
                    other => other.key === attribute.key && other.value === attribute.value
                )),
                0
            );
            return matches(second) - matches(first);
        });

        return res.status(200).json({ items: alternatives });
    } catch (error) {
        next(error);
    }
}
