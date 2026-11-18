import { Router } from 'express';
import { getDeliveryStatus, createReservation } from '../controllers/reservationController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

//Add other reservation routes here
router.post('/', requireAuth, requireRole('member', 'lender', 'admin'), createReservation);


//This route may be temporary as when full reservation GET request is implemented it might be redundant to have one for delivery only.
router.get('/:reservationId/delivery', requireAuth, requireRole('member', 'lender', 'admin'), getDeliveryStatus);

export default router;
