import { Router } from 'express';
import {
    updateSuspension,
    viewUserDetails,
    listUsers,
    listItems,
    removeUser,
    searchUsers,
    createAdmin,
    updateCategoryDepositMultiplier
} from '../controllers/adminController.js';

import { createNotice } from '../controllers/noticeController.js';
import { listReports, reviewReport } from '../controllers/reportController.js';
import { createPromoCode, listPromoCodes, getPromoCodeUsage } from '../controllers/promoCodeController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
const authenticate = requireAuth;
const requireAdmin = requireRole('admin');
const router = Router();
router.patch('/users/:id/suspension', authenticate, requireAdmin, updateSuspension);
router.get('/users/search', authenticate, requireAdmin, searchUsers);
router.get('/users/:id', authenticate, requireAdmin, viewUserDetails);
router.get('/users', authenticate, requireAdmin, listUsers);
router.get('/items', authenticate, requireAdmin, listItems);
router.delete('/users/:id', authenticate, requireAdmin, removeUser);
router.post('/users/admins', authenticate, requireAdmin, createAdmin);
router.patch('/categories/:id/deposit-multiplier', authenticate, requireAdmin, updateCategoryDepositMultiplier);
router.get('/reports', authenticate, requireAdmin, listReports);
router.patch('/reports/:id/decision', authenticate, requireAdmin, reviewReport);
router.post('/promo-codes', authenticate, requireAdmin, createPromoCode);
router.get('/promo-codes', authenticate, requireAdmin, listPromoCodes);
router.get('/promo-codes/usage', authenticate, requireAdmin, getPromoCodeUsage);
router.post('/notices', authenticate, requireAdmin, createNotice);

export default router;
