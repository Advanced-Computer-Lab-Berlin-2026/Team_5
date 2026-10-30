import { Router } from 'express';
import {
    registerUser,
    login,
    logout,
    refresh,
    forgetPassword,
    verifyResetOtp,
    resetPassword,
    changePassword
} from '../controllers/authController.js';
import { authLimiters } from '../middleware/authSecurity.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.post('/register', authLimiters.register, registerUser);
router.post('/login', authLimiters.login, login);
router.post('/logout', authLimiters.logout, logout);
router.post('/refresh', authLimiters.refresh, refresh);
router.post('/forget-password', authLimiters.passwordReset, forgetPassword);
router.post('/verify-reset-otp', authLimiters.passwordReset, verifyResetOtp);
router.post('/reset-password', authLimiters.passwordReset, resetPassword);
router.patch('/change-password', requireAuth, changePassword);

export default router;