import { Router } from 'express';
import { submitReport } from '../controllers/reportController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.post('/', requireAuth, requireRole('member'), submitReport);

export default router;