import { Router } from 'express';
import {searchMember,sendHouseholdRequest,getIncomingRequests,respondToRequest} from '../controllers/householdController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/search', requireAuth, searchMember);
router.post('/requests', requireAuth, sendHouseholdRequest);
router.get('/requests/incoming', requireAuth, getIncomingRequests);
router.patch('/requests/:requestId', requireAuth, respondToRequest);

export default router;