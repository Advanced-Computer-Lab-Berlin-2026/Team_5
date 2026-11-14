import { Router } from 'express';
import { getWalletBalance, payWalletCheckout } from '../controllers/walletController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

//define my routes here
router.get('/', requireAuth, getWalletBalance);
router.post('/checkout', requireAuth, requireRole('member'), payWalletCheckout);
export default router;