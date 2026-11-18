import { Router } from 'express';
import { getMyReservations, cancelReservation, getDeliveryStatus } from '../controllers/reservationController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, requireRole('member', 'lender'), getMyReservations);
router.patch('/:reservationId/cancel', requireAuth, requireRole('member', 'lender'), cancelReservation);
router.get('/:reservationId/delivery', requireAuth, requireRole('member', 'lender', 'admin'), getDeliveryStatus);

export default router;