import { Router } from 'express';
import { updateSuspension } from '../controllers/adminController.js';
import requireAdmin from '../middleware/requireAdmin.js';
import authenticate from '../middleware/authenticate.js';
const router = Router();
router.patch('/users/:id/suspension', authenticate, requireAdmin, updateSuspension);


export default router;