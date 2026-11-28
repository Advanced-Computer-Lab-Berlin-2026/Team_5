import { Router } from 'express';
import { validatePromoCode } from '../controllers/promoCodeController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.post('/validate', requireAuth, requireRole('member', 'lender'), validatePromoCode);

export default router;