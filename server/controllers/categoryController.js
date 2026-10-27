import { Category } from '../models/index.js';

// GET /api/categories
// gives back { _id, name } for each category. _id is what items store, name is for showing
export async function listCategories(req, res, next) {
    try {
        const categories = await Category.find({}, { name: 1 }, { sort: { name: 1 }, lean: true });
        res.status(200).json({ categories });
    } catch (error) {
        next(error);
    }
}

// runs before listItems on /api/categories/:id/items
// the url takes the _id only, not the name, to avoid conflicts if a category gets renamed. the _id stays the same after a rename, and it's what items store in category
// a category page that doesn't exist is a 404, unlike ?category= on /api/items which just gives an empty list
export async function requireCategory(req, res, next) {
    try {
        const exists = await Category.exists({ _id: req.params.id });
        if (!exists) return res.status(404).json({ message: 'Category not found' });
        next();
    } catch (error) {
        next(error);
    }
}

// listItems reads the category from ?category=, so I hand it the one from the url instead
// express 5 won't let me assign req.query directly, so I put my own copy on this request
export function useCategoryFromUrl(req, res, next) {
    Object.defineProperty(req, 'query', { value: { ...req.query, category: req.params.id } });
    next();
}
