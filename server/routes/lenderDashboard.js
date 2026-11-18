import { Router } from 'express';
import { getLenderDashboard } from '../controllers/lenderDashboardController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, requireRole('lender'), getLenderDashboard);

export default router;
