import joi from 'joi';
import { Reservation } from '../models/Reservation.js';
import { notifyDeliveryStatus } from '../services/notificationService.js';

const RESERVATION_ID_PATTERN = /^RES-[0-9a-f]{8}$/;
const DELIVERY_STATUSES = ['preparing', 'out-for-delivery', 'delivered'];
const updateDeliverySchema = joi.object({
    status: joi.string().valid(...DELIVERY_STATUSES).required()
});

function canViewDelivery(user, reservation) {
    if (user.role === 'admin') return true;
    else return reservation.borrower === user.id;

}

export async function getDeliveryStatus(req, res, next) {
    try {
        const { reservationId } = req.params;
        if (!RESERVATION_ID_PATTERN.test(reservationId)) {
            return res.status(400).json({ message: 'Invalid reservation id' });
        }

        const reservation = await Reservation.findById(reservationId).lean();
        if (!reservation) {
            return res.status(404).json({ message: 'Reservation not found' });
        }
        if (!canViewDelivery(req.user, reservation)) {
            return res.status(404).json({ message: 'Reservation not found' });
        }

        if (!reservation.delivery || Object.keys(reservation.delivery).length === 0) {
            return res.status(404).json({ message: 'No delivery data' });
        }

        return res.status(200).json(reservation.delivery);
    } catch (error) {
        next(error);
    }
}

function canUpdateDelivery(user, reservation) {
    return user.role === 'admin' || reservation.lender === user.id;
}

export async function updateDeliveryStatus(req, res, next) {
    try {
        const { reservationId } = req.params;

        if (!RESERVATION_ID_PATTERN.test(reservationId)) {
            return res.status(400).json({ message: 'Invalid reservation id' });
        }

        const { value, error } = updateDeliverySchema.validate(req.body ?? {}, {
            stripUnknown: true
        });
        if (error) {
            return res.status(400).json({ message: error.message });
        }

        const reservation = await Reservation.findById(reservationId).lean();
        if (!reservation) {
            return res.status(404).json({ message: 'Reservation not found' });
        }
        if (!canUpdateDelivery(req.user, reservation)) {
            return res.status(403).json({ message: 'Forbidden' });
        }

        const updatedReservation = await Reservation.findByIdAndUpdate(
            reservationId,
            { $set: { 'delivery.status': value.status } },
            { new: true, runValidators: true }
        ).lean();

        if (!updatedReservation) {
            return res.status(404).json({ message: 'Reservation not found' });
        }

        if (
            reservation.delivery?.status !== value.status &&
            ['out-for-delivery', 'delivered'].includes(value.status)
        ) {
            await notifyDeliveryStatus(reservation, value.status);
        }

        return res.status(200).json({
            message: `Updated status to ${value.status}`
        });
    } catch (error) {
        next(error);
    }
}
