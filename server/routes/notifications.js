import { Router } from 'express';
import { listNotifications, markNotificationRead } from '../controllers/notificationController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// any logged-in role, everyone gets notifications
router.get('/', requireAuth, listNotifications);
router.patch('/:id/read', requireAuth, markNotificationRead);

export default router;
