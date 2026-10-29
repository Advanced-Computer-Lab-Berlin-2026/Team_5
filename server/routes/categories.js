import { Router } from 'express';
import { listCategories, requireCategory, useCategoryFromUrl } from '../controllers/categoryController.js';
import { listItems } from '../controllers/itemController.js';

const router = Router();

// public on purpose (SCRUM-242). a guest can list categories and open a category page with no cookie.
router.get('/', listCategories);
router.get('/:id/items', requireCategory, useCategoryFromUrl, listItems);

export default router;
