import { Router } from 'express';
import { searchMember, sendHouseholdRequest } from '../controllers/householdController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/search', requireAuth, searchMember);
router.post('/requests', requireAuth, sendHouseholdRequest);

export default router;