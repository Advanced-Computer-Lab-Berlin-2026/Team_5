import { Router } from 'express';
import { updateSuspension, viewUserDetails, listUsers, listItems } from '../controllers/adminController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const authenticate = requireAuth;
const requireAdmin = requireRole('admin');
const router = Router();
router.patch('/users/:id/suspension', authenticate, requireAdmin, updateSuspension);
router.get('/users/:id', authenticate, requireAdmin, viewUserDetails);
router.get('/users', authenticate, requireAdmin, listUsers);
router.get('/items',authenticate,requireAdmin,listItems);

export default router;