import { Router } from 'express';
import { listItems, getItem, getItemCalendar, getItemManual } from '../controllers/itemController.js';
import { catalogViewer, requireAuth } from '../middleware/auth.js'


const router = Router();

// public on purpose (SCRUM-242 / 243). a guest can list, open items, and view manuals with no cookie.
router.get('/', catalogViewer, listItems);
router.get('/:id/manual', getItemManual);
router.get('/:id', getItem);

// SCRUM-341, any logged in user should be able to view the reservation calendar of an item
router.get('/:id/calendar', requireAuth, getItemCalendar);

export default router;
