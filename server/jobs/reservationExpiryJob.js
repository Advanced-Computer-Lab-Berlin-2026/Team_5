import { Reservation } from '../models/Reservation.js';
import { expireUnansweredReservation } from '../services/reservationCancellationService.js';

export async function runReservationExpiryJob(now = new Date()) {
    const overdue = Reservation.find(
        { status: 'pending', startDate: { $lte: now }, 'handover.pickedUpAt': null },
        { _id: 1 }
    ).lean().cursor();

    for await (const reservation of overdue) {
        try {
            await expireUnansweredReservation(reservation._id);
        } catch (error) {
            console.error(`Failed to expire reservation ${reservation._id}`, error);
        }
    }
}
