import { Router } from 'express';
import { listItems, getItem, getItemCalendar } from '../controllers/itemController.js';
import { requireAuth } from '../middleware/auth.js'


const router = Router();

// public on purpose (SCRUM-242). a guest can list and open items with no cookie.
router.get('/', listItems);
router.get('/:id', getItem);

// SCRUM-341, any logged in user should be able to view the reservation calendar of an item
router.get('/:id/calendar', requireAuth, getItemCalendar);

export default router;
