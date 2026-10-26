import { Router } from 'express';
import { listItems } from '../controllers/itemController.js';

const router = Router();

router.get('/', listItems);

export default router;
