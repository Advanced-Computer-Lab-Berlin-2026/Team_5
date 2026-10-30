import { Router } from 'express';
import {searchMember,sendHouseholdRequest,getIncomingRequests,respondToRequest,getMyLinks,removeLink} from '../controllers/householdController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

// households are only for members and verified lenders, admins cannot use any of these routes
router.use(requireAuth, requireRole('member', 'lender'));

router.get('/search', searchMember);
router.post('/requests', sendHouseholdRequest);
router.get('/requests/incoming', getIncomingRequests);
router.patch('/requests/:requestId', respondToRequest);
router.get('/links', getMyLinks);
router.delete('/links/:linkId', removeLink);

export default router;