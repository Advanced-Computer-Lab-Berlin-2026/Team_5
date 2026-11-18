import { Router } from 'express';
import { removeFromBorrowList } from '../controllers/borrowListController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.delete('/:itemId', requireAuth, requireRole('member', 'lender'), removeFromBorrowList);

export default router;