
import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { createPaymentIntent, getCardPaymentStatus } from '../controllers/stripeController.js';

const router = Router();

router.post('/payment-intent', requireAuth, requireRole('member', 'lender'), createPaymentIntent);
router.get('/payments/:paymentId/status', requireAuth, requireRole('member', 'lender'), getCardPaymentStatus);

export default router;
