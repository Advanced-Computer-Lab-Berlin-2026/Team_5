import { Router } from 'express';
import { listItems, getItem } from '../controllers/itemController.js';

const router = Router();

// public on purpose (SCRUM-242). a guest can list and open items with no cookie.
router.get('/', listItems);
router.get('/:id', getItem);

export default router;
