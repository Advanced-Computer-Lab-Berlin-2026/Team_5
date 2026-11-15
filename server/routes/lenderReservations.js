import { Router } from 'express';
import { markPickedUp, markReturnedGood } from '../controllers/lenderReservationController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.patch('/:id/pickup', requireAuth, requireRole('lender'), markPickedUp);
router.patch('/:id/return', requireAuth, requireRole('lender'), markReturnedGood);

export default router;
