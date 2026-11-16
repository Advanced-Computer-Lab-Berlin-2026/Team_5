import joi from 'joi';
import { Reservation } from '../models/Reservation.js';

const RESERVATION_ID_PATTERN = /^RES-[0-9a-f]{8}$/;
const CHAT_STATUSES = ['upcoming', 'active'];

const listMessagesSchema = joi.object({
    after: joi.date().iso()
});

const sendMessageSchema = joi.object({
    text: joi.string().trim().min(1).max(1000).required()
});

// borrower or lender of this reservation only; same 404 for outsiders so they can't probe ids
function participantFilter(reservationId, userId) {
    return {
        _id: reservationId,
        $or: [{ borrower: userId }, { lender: userId }]
    };
}

// GET /api/reservations/:reservationId/messages
export async function listReservationMessages(req, res, next) {
    try {
        const { reservationId } = req.params;
        if (!RESERVATION_ID_PATTERN.test(reservationId)) {
            return res.status(400).json({ message: 'Invalid reservation id' });
        }

        const { value, error } = listMessagesSchema.validate(req.query);
        if (error) return res.status(400).json({ message: error.message });

        const reservation = await Reservation.findOne(
            participantFilter(reservationId, req.user.id),
            { messages: 1, status: 1 },
            { lean: true }
        );
        if (!reservation) return res.status(404).json({ message: 'Reservation not found' });
        // story is only upcoming / active chat; pending and finished bookings stay quiet
        if (!CHAT_STATUSES.includes(reservation.status)) {
            return res.status(403).json({ message: 'Chat is only available for upcoming or active reservations' });
        }

        let messages = reservation.messages ?? [];
        if (value.after) {
            messages = messages.filter((message) => new Date(message.date) > value.after);
        }

        res.status(200).json({ messages });
    } catch (error) {
        next(error);
    }
}

// POST /api/reservations/:reservationId/messages
export async function sendReservationMessage(req, res, next) {
    try {
        const { reservationId } = req.params;
        if (!RESERVATION_ID_PATTERN.test(reservationId)) {
            return res.status(400).json({ message: 'Invalid reservation id' });
        }

        const { value, error } = sendMessageSchema.validate(req.body);
        if (error) return res.status(400).json({ message: error.message });

        // status in the filter so a completed booking can't get new messages from a double-open tab
        const reservation = await Reservation.findOneAndUpdate(
            { ...participantFilter(reservationId, req.user.id), status: { $in: CHAT_STATUSES } },
            { $push: { messages: { text: value.text, sender: req.user.id } } },
            { returnDocument: 'after', lean: true, projection: { messages: 1 } }
        );
        if (!reservation) {
            // either missing, not theirs, or wrong status — check which so the ui can tell them apart
            const existing = await Reservation.findOne(
                participantFilter(reservationId, req.user.id),
                { status: 1 },
                { lean: true }
            );
            if (!existing) return res.status(404).json({ message: 'Reservation not found' });
            return res.status(403).json({ message: 'Chat is only available for upcoming or active reservations' });
        }

        const message = reservation.messages.at(-1);
        res.status(201).json({ message });
    } catch (error) {
        next(error);
    }
}
