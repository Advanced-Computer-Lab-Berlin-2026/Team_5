import { Router } from 'express';
import { tempAuth } from '../middleware/tempAuth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { listLenderRequests, getLenderRequest, getLenderRequestDocument , decideLenderRequest } from '../controllers/adminLenderRequestController.js';

const router = Router();

router.use(tempAuth, requireAdmin);

router.get('/', listLenderRequests);
router.get('/:id', getLenderRequest);
router.get('/:id/documents/:slot', getLenderRequestDocument);
router.patch('/:id/decision', decideLenderRequest);



export default router;
