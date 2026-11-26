import { Router } from 'express';
import { getMyMembership, subscribeToTier, cancelMembership } from '../controllers/membershipController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.post('/subscribe', requireAuth, requireRole('member', 'lender'), subscribeToTier);
router.post('/cancel', requireAuth, requireRole('member', 'lender'), cancelMembership);
router.get('/', requireAuth, requireRole('member', 'lender'), getMyMembership);

export default router;