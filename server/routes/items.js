import { Router } from 'express';
import { listItems, getItem, getItemManual } from '../controllers/itemController.js';

const router = Router();

// public on purpose (SCRUM-242 / 243). a guest can list, open items, and view manuals with no cookie.
router.get('/', listItems);
router.get('/:id/manual', getItemManual);
router.get('/:id', getItem);

export default router;
