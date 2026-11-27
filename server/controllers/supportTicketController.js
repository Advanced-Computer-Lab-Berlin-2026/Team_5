import joi from 'joi';
import { SupportTicket } from '../models/SupportTicket.js';

const submitTicketSchema = joi.object({
    subject: joi.string().trim().min(3).max(120).required(),
    message: joi.string().trim().min(1).max(5000).required(),
});

const respondTicketSchema = joi.object({
    message: joi.string().trim().min(1).max(5000).required(),
    resolve: joi.boolean().default(false),
});

const TICKET_STATUSES = ['in-progress', 'resolved'];

// POST /api/support-tickets
export async function submitSupportTicket(req, res, next) {
    try {
        const { value, error } = submitTicketSchema.validate(req.body ?? {}, { stripUnknown: true });
        if (error) return res.status(400).json({ message: error.message });

        const ticket = await SupportTicket.create({
            user: req.user.id,
            subject: value.subject,
            status: 'in-progress',
            messages: [{
                sender: req.user.id,
                userType: req.user.role === 'lender' ? 'lender' : 'member',
                text: value.message,
            }],
        });

        return res.status(201).json({ ticket });
    } catch (error) {
        next(error);
    }
}

// GET /api/support-tickets
export async function listMemberSupportTickets(req, res, next) {
    try {
        const tickets = await SupportTicket.find({ user: req.user.id })
            .sort({ updatedAt: -1 })
            .lean();
        return res.status(200).json({ tickets });
    } catch (error) {
        next(error);
    }
}

// GET /api/admin/support-tickets?status=in-progress
export async function listAdminSupportTickets(req, res, next) {
    try {
        const status = req.query.status;
        if (status && status !== 'all' && !TICKET_STATUSES.includes(status)) {
            return res.status(400).json({ message: 'Status must be in-progress, resolved, or all' });
        }

        const filter = !status || status === 'all' ? {} : { status };
        const tickets = await SupportTicket.find(filter)
            .sort({ updatedAt: -1 })
            .populate('user', 'username profile.name profile.email')
            .lean();
        return res.status(200).json({ tickets });
    } catch (error) {
        next(error);
    }
}

// POST /api/admin/support-tickets/:id/respond
export async function respondToSupportTicket(req, res, next) {
    try {
        const { value, error } = respondTicketSchema.validate(req.body ?? {}, { stripUnknown: true });
        if (error) return res.status(400).json({ message: error.message });

        const ticket = await SupportTicket.findOneAndUpdate(
            { _id: req.params.id, status: 'in-progress' },
            {
                $set: {
                    respondedBy: req.user.id,
                    ...(value.resolve ? { status: 'resolved' } : {}),
                },
                $push: {
                    messages: {
                        sender: req.user.id,
                        userType: 'admin',
                        text: value.message,
                        seen: false,
                    },
                },
            },
            { new: true, runValidators: true }
        );

        if (!ticket) {
            const existing = await SupportTicket.exists({ _id: req.params.id });
            if (!existing) return res.status(404).json({ message: 'Support ticket not found' });
            return res.status(409).json({ message: 'Resolved tickets cannot receive further replies' });
        }

        return res.status(200).json({ ticket });
    } catch (error) {
        next(error);
    }
}