import { Reservation } from '../models/Reservation.js';
import { cancelReservationWithRefund } from '../services/reservationCancellationService.js';
import { CheckoutError } from '../utils/CheckoutError.js';
const RESERVATION_ID_PATTERN = /^RES-[0-9a-f]{8}$/;

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

export async function cancelReservation(req, res, next) {
    try {
        const result = await cancelReservationWithRefund(
            req.params.reservationId,
            req.user.id
        );

        return res.status(200).json(result);

    } catch (error) {
        if (error instanceof CheckoutError) {
            return res.status(error.statusCode).json({
                error: error.code,
                message: error.message
            });
        }

        return next(error);
    }
}
