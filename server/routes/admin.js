import { Router } from 'express';
import {
    updateSuspension,
    viewUserDetails,
    listUsers,
    listItems,
    removeUser,
    searchUsers,
    createAdmin
} from '../controllers/adminController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
const authenticate = requireAuth;
const requireAdmin = requireRole('admin');
const router = Router();
router.patch('/users/:id/suspension', authenticate, requireAdmin, updateSuspension);
router.get('/users/search', authenticate, requireAdmin, searchUsers);
router.get('/users/:id', authenticate, requireAdmin, viewUserDetails);
router.get('/users', authenticate, requireAdmin, listUsers);
router.get('/items', authenticate, requireAdmin, listItems);
router.delete('/users/:id', authenticate, requireAdmin, removeUser);
router.post('/users/admins', authenticate, requireAdmin, createAdmin);

export default router;