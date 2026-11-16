import { Router } from 'express';
import { getAlternatives } from '../controllers/alternativeController.js';

const router = Router();

router.get('/:itemId', getAlternatives);

export default router;
