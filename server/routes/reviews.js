import { Router } from 'express';
import {
    reviewLender,
    reviewBorrower,
    getUserTrustAndReviews,
    getMyReviews
} from '../controllers/reviewController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/me', requireAuth, requireRole('member', 'lender'), getMyReviews);
router.get('/users/:username', requireAuth, requireRole('member', 'lender', 'admin'), getUserTrustAndReviews);
router.post('/reservations/:reservationId/lender', requireAuth, requireRole('member', 'lender'), reviewLender);
router.post('/reservations/:reservationId/borrower', requireAuth, requireRole('lender'), reviewBorrower);

export default router;