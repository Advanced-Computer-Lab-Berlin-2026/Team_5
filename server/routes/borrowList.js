import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { removeFromBorrowList, addToBorrowList, updateBorrowListDates, getBorrowList } from '../controllers/borrowListController.js';

const router = Router();

const requireBorrower = requireRole('member', 'lender');

router.get('/', requireAuth, requireBorrower, getBorrowList);
router.post('/:itemId', requireAuth, requireBorrower, addToBorrowList);
router.patch('/:itemId', requireAuth, requireBorrower, updateBorrowListDates);
router.delete('/:itemId', requireAuth, requireBorrower, removeFromBorrowList);

export default router;
