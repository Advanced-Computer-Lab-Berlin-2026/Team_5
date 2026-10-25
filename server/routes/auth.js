import { Router } from 'express';
import { registerMember, login } from '../controllers/authController.js';

const router = Router()

router.post('/register', registerMember);
router.post('/login', login);

export default router;