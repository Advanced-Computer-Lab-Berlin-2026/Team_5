import { Router } from 'express';
import { updateSuspension } from '../controllers/adminController.js';
import requireAdmin from '../middleware/requireAdmin.js';
const router = Router();
router.patch('/users/:id/suspension', requireAdmin, updateSuspension);


export default router;