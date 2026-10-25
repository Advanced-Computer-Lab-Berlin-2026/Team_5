import { Router } from 'express';
import { registerUser, login, logout, refresh } from '../controllers/authController.js';

const router = Router();

router.post('/register', registerUser);
router.post('/login', login);
router.post('/logout', logout);
router.post('/refresh', refresh);

export default router;