import { Router } from 'express';
import {
    submitSupportTicket,
    listMemberSupportTickets,
} from '../controllers/supportTicketController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.post('/', requireAuth, requireRole('member'), submitSupportTicket);
router.get('/', requireAuth, requireRole('member'), listMemberSupportTickets);

export default router;