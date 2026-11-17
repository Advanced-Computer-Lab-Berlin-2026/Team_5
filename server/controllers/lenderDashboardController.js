import { Item, Reservation, DamageReport } from '../models/index.js';
import { toPercent } from './reportController.js';

// The item actually left the lender's hands. Pending, upcoming, cancelled and rejected ones never did.
const LENT_STATUSES = ['active', 'completed'];

// GET /api/lender/dashboard
export async function getLenderDashboard(req, res, next) {
    try {
        const lender = req.user.id;
        const [listedItems, reservations] = await Promise.all([
            Item.countDocuments({ owner: lender }),
            Reservation.find({ lender, status: { $in: LENT_STATUSES } }).select('item payment.depositAmount').lean()
        ]);

        // A reservation counts once, even if it has a report, a dispute and a resolution
        const damagedReservations = reservations.length === 0 ? [] : await DamageReport.distinct('reservation', {
            reservation: { $in: reservations.map(reservation => reservation._id) },
            type: 'report'
        });

        return res.status(200).json({
            dashboard: {
                listedItems,
                itemsLent: {
                    timesLent: reservations.length,
                    distinctItems: new Set(reservations.map(reservation => reservation.item)).size
                },
                totalDepositsCollected: reservations.reduce((sum, reservation) => sum + (reservation.payment?.depositAmount ?? 0), 0),
                damageIncidents: damagedReservations.length,
                damageIncidentRate: toPercent(damagedReservations.length, reservations.length)
            }
        });
    } catch (error) {
        next(error);
    }
}
