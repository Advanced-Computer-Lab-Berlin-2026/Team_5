import { Router } from 'express';
import { getWaitlist, joinWaitlist, leaveWaitlist } from '../controllers/waitlistController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.post('/:itemId', requireAuth, requireRole('member', 'admin', 'lender'), joinWaitlist);
router.delete('/:itemId', requireAuth, requireRole('member', 'admin', 'lender'), leaveWaitlist);
router.get('/', requireAuth, requireRole('member', 'admin', 'lender'), getWaitlist);

export default router;
