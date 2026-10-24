import { Router } from 'express';
import { registerMember } from '../controllers/authController.js';

const router = Router()

router.post('/register', registerMember);

export default router;