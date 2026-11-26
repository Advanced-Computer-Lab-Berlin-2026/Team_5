import { Router } from 'express';
import { getMyReferralInfo, applyReferralCode } from '../controllers/referralController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/me', requireAuth, requireRole('member', 'lender'), getMyReferralInfo);
router.post('/apply', requireAuth, requireRole('member', 'lender'), applyReferralCode);

export default router;