import { Router } from 'express';
import { getDamageCase, decideDamageCase, resolveDamageCase } from '../controllers/adminDamageReportController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

// :id is the case number, the id of the lender's damage report (DMG-xxxxxxxx).
// Admins find cases in GET /api/admin/reports/damage.
router.get('/:id', requireAuth, requireRole('admin'), getDamageCase);
router.post('/:id/decision', requireAuth, requireRole('admin'), decideDamageCase);
router.post('/:id/resolution', requireAuth, requireRole('admin'), resolveDamageCase);

export default router;
