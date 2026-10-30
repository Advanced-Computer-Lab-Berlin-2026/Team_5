import { Router } from 'express';
import { updateProfile } from '../controllers/profileController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.patch('/', requireAuth, requireRole('member', 'lender'), updateProfile);

export default router;