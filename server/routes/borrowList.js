import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { removeFromBorrowList, addToBorrowList, getBorrowList } from '../controllers/borrowListController.js';

const router = Router();

const requireBorrower = requireRole('member', 'lender');

router.get('/', requireAuth, requireBorrower, getBorrowList);
router.post('/:itemId', requireAuth, requireBorrower, addToBorrowList);
router.delete('/:itemId', requireAuth, requireRole('member', 'lender'), removeFromBorrowList);

export default router;
