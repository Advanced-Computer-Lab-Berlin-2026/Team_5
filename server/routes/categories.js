import { Router } from 'express';
import { listCategories, requireCategory, useCategoryFromUrl } from '../controllers/categoryController.js';
import { listItems } from '../controllers/itemController.js';

const router = Router();

router.get('/', listCategories);
router.get('/:id/items', requireCategory, useCategoryFromUrl, listItems);

export default router;
