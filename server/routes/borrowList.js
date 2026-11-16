import { Router } from 'express';
import { addToBorrowList, getBorrowList } from '../controllers/borrowListController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const requireBorrower = requireRole('member', 'lender');
const router = Router();

router.get('/', requireAuth, requireBorrower, getBorrowList);
router.post('/:itemId', requireAuth, requireBorrower, addToBorrowList);

export default router;
