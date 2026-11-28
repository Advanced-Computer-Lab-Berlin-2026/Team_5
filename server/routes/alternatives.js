import { Router } from 'express';
import { getAlternatives } from '../controllers/alternativeController.js';
import { catalogViewer } from '../middleware/auth.js';

const router = Router();

router.get('/:itemId', catalogViewer, getAlternatives);

export default router;
