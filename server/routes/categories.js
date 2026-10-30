import { Router } from 'express';
import { listCategories, requireCategory } from '../controllers/categoryController.js';
import { listItems } from '../controllers/itemController.js';

const router = Router();

// public on purpose (SCRUM-242). a guest can list categories and open a category page with no cookie.
router.get('/', listCategories);
// category comes from ?category=, same field listItems already reads, so no query rewriting
router.get('/items', requireCategory, listItems);

export default router;
