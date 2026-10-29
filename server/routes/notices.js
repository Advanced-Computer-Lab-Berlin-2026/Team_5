import { Router } from 'express';
import { listNotices } from '../controllers/noticeController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, listNotices);

export default router;
