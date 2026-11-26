import { Router } from 'express';
import {
    getMyReservations,
    cancelReservation,
    createReservation,
    getDeliveryStatus,
    updateDeliveryStatus,
    requestReservationExtension
} from '../controllers/reservationController.js';
import { listReservationMessages, sendReservationMessage } from '../controllers/reservationMessageController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, requireRole('member', 'lender'), getMyReservations);
router.post('/', requireAuth, requireRole('member', 'lender', 'admin'), createReservation);
router.patch('/:reservationId/cancel', requireAuth, requireRole('member', 'lender'), cancelReservation);
router.post('/:reservationId/cancel', requireAuth, requireRole('member', 'lender'), cancelReservation);

//This route may be temporary as when full reservation GET request is implemented it might be redundant to have one for delivery only.
router.get('/:reservationId/delivery', requireAuth, requireRole('member', 'lender', 'admin'), getDeliveryStatus);
router.post('/:reservationId/delivery', requireAuth, requireRole('lender', 'admin'), updateDeliveryStatus);

// borrower or lender of an upcoming/active reservation only — outsiders get the same 404 as a missing id
router.get('/:reservationId/messages', requireAuth, listReservationMessages);
router.post('/:reservationId/messages', requireAuth, sendReservationMessage);
router.post('/:reservationId/extensions', requireAuth, requireRole('member'), requestReservationExtension);
export default router;
