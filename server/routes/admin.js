import { Router } from 'express';
import { updateSuspension, viewUserDetails } from '../controllers/adminController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const authenticate = requireAuth;
const requireAdmin = requireRole('admin');
const router = Router();
router.patch('/users/:id/suspension', authenticate, requireAdmin, updateSuspension);
router.get('/users/:id', authenticate, requireAdmin, viewUserDetails);

export default router;