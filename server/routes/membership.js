import { Router } from 'express';
import { subscribeToTier, cancelMembership } from '../controllers/membershipController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

// admins do not borrow, so only members and lenders can have a membership
router.post('/subscribe', requireAuth, requireRole('member', 'lender'), subscribeToTier);
router.post('/cancel', requireAuth, requireRole('member', 'lender'), cancelMembership);

export default router;
