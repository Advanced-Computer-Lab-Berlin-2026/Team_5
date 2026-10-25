import { Router } from 'express';
import { registerUser, login, logout, refresh, forgetPassword, verifyResetOtp, resetPassword } from '../controllers/authController.js';

const router = Router();

router.post('/register', registerUser);
router.post('/login', login);
router.post('/logout', logout);
router.post('/refresh', refresh);
router.post('/forget-password', forgetPassword);
router.post('/verify-reset-otp', verifyResetOtp);
router.post('/reset-password', resetPassword);

export default router;
