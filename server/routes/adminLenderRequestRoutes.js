import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { listLenderRequests, getLenderRequest, getLenderRequestDocument , decideLenderRequest } from '../controllers/adminLenderRequestController.js';

const router = Router();

router.use(requireAuth, requireRole('admin'));

router.get('/', listLenderRequests);
router.get('/:id', getLenderRequest);
router.get('/:id/documents/:slot', getLenderRequestDocument);
router.patch('/:id/decision', decideLenderRequest);



export default router;
