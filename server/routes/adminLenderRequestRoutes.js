import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { listLenderRequests, getLenderRequest, getLenderRequestDocument, decideLenderRequest } from '../controllers/adminLenderRequestController.js';

const router = Router();

router.use(requireAuth, requireRole('admin'));

router.get('/', listLenderRequests);
router.get('/:username', getLenderRequest);
router.get('/:username/documents/:slot', getLenderRequestDocument);
router.patch('/:username/decision', decideLenderRequest);

export default router;
