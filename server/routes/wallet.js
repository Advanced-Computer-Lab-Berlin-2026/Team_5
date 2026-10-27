import { Router } from 'express';
import { getWalletBalance } from '../controllers/walletController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

//define my routes here
router.get('/', requireAuth, getWalletBalance);

export default router;