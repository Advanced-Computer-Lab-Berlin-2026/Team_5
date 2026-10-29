import { Router } from 'express';
import { updateCategoryDepositMultiplier, updateSuspension, viewUserDetails } from '../controllers/adminController.js';
import { createNotice } from '../controllers/noticeController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const authenticate = requireAuth;
const requireAdmin = requireRole('admin');
const router = Router();
router.patch('/users/:id/suspension', authenticate, requireAdmin, updateSuspension);
router.get('/users/:id', authenticate, requireAdmin, viewUserDetails);
router.patch('/categories/:id/deposit-multiplier', authenticate, requireAdmin, updateCategoryDepositMultiplier);
router.post('/notices', authenticate, requireAdmin, createNotice);

export default router;