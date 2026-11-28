import { Router } from 'express';
import { getWalletBalance, payWalletCheckout, quoteWalletCheckout, getLateFees } from '../controllers/walletController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

//define my routes here
router.get('/', requireAuth, getWalletBalance);
router.post('/checkout/quote', requireAuth, requireRole('member', 'lender'), quoteWalletCheckout);
router.post('/checkout', requireAuth, requireRole('member', 'lender'), payWalletCheckout);
router.get('/late-fees',requireAuth,requireRole('member', 'lender'),getLateFees);
export default router;
