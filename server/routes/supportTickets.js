import { Router } from 'express';
import {
    submitSupportTicket,
    listMemberSupportTickets,
} from '../controllers/supportTicketController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

// members and lenders can both ask the admins for help
router.post('/', requireAuth, requireRole('member', 'lender'), submitSupportTicket);
router.get('/', requireAuth, requireRole('member', 'lender'), listMemberSupportTickets);

export default router;