import { Router } from 'express';
import {
    getUsageReport,
    exportUsageReport,
    getDamageReport,
    exportDamageReport,
    getTierDistribution
} from '../controllers/reportController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const requireAdmin = requireRole('admin');
const router = Router();

router.get('/usage', requireAuth, requireAdmin, getUsageReport);
router.get('/usage/export', requireAuth, requireAdmin, exportUsageReport);
router.get('/damage', requireAuth, requireAdmin, getDamageReport);
router.get('/damage/export', requireAuth, requireAdmin, exportDamageReport);
router.get('/membership-tiers', requireAuth, requireAdmin, getTierDistribution);

export default router;
