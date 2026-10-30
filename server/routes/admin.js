import { Router } from 'express';
import { createNotice } from '../controllers/noticeController.js';
import { updateCategoryDepositMultiplier, updateSuspension, viewUserDetails, listUsers, listItems, removeUser } from '../controllers/adminController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const authenticate = requireAuth;
const requireAdmin = requireRole('admin');
const router = Router();
router.patch('/users/:id/suspension', authenticate, requireAdmin, updateSuspension);
router.get('/users/:id', authenticate, requireAdmin, viewUserDetails);
router.patch('/categories/:id/deposit-multiplier', authenticate, requireAdmin, updateCategoryDepositMultiplier);
router.post('/notices', authenticate, requireAdmin, createNotice);

router.get('/users', authenticate, requireAdmin, listUsers);
router.get('/items',authenticate,requireAdmin,listItems);
router.delete('/users/:id',authenticate,requireAdmin,removeUser);
export default router;
