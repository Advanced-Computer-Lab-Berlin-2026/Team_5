import { Router } from 'express';
import { getWalletBalance } from '../controllers/walletController.js';

const router = Router();

//define my routes here
router.get('/', getWalletBalance);

export default router;