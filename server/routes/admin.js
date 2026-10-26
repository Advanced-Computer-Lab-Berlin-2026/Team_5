import { Router } from 'express';
import { updateSuspension, viewUserDetails } from '../controllers/adminController.js';
import requireAdmin from '../middleware/requireAdmin.js';
import authenticate from '../middleware/authenticate.js';
const router = Router();
router.patch('/users/:id/suspension', authenticate, requireAdmin, updateSuspension);
router.get('/users/:id', authenticate, requireAdmin, viewUserDetails);

export default router;