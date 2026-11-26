import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { listMembershipTiers } from '../controllers/membershipTierController.js';

const router = Router();

router.get('/', requireAuth, requireRole('member', 'lender'), listMembershipTiers);

export default router;
