import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { getMyMembership } from '../controllers/membershipController.js';

const router = Router();

router.get('/', requireAuth, requireRole('member', 'lender'), getMyMembership);

export default router;
