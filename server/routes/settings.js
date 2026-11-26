import { Router } from 'express';
import { getEmailPreferences, updateEmailPreferences } from '../controllers/emailPreferencesController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

// SCRUM-517: member/lender email on/off by category (518 will call these from settings UI)
router.get('/email-preferences', requireAuth, requireRole('member', 'lender'), getEmailPreferences);
router.patch('/email-preferences', requireAuth, requireRole('member', 'lender'), updateEmailPreferences);

export default router;
