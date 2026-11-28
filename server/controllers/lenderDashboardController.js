import { Item, Reservation, DamageReport, Payment } from '../models/index.js';
import { toPercent } from './reportController.js';

// The item actually left the lender's hands. Pending, upcoming, cancelled and rejected ones never did.
const LENT_STATUSES = ['active', 'completed'];

// GET /api/lender/dashboard
export async function getLenderDashboard(req, res, next) {
    try {
        const lender = req.user.id;
        const [listedItems, reservations] = await Promise.all([
            Item.countDocuments({ owner: lender }),
            Reservation.find({ lender, status: { $in: LENT_STATUSES } }).select('item payment.depositAmount payment.depositCollected').lean()
        ]);

        // A reservation counts once, even if it has a report, a dispute and a resolution
        const damagedReservations = reservations.length === 0 ? [] : await DamageReport.distinct('reservation', {
            reservation: { $in: reservations.map(reservation => reservation._id) },
            type: 'report'
        });
        const ids = reservations.filter(row => row.payment?.depositCollected !== false).map(row => row._id);
        const deposits = ids.length ? await Payment.find({
            type: 'deposit-paid', direction: 'deduct', status: { $in: ['completed', null] },
            $or: [{ reservation: { $in: ids } }, { reservations: { $in: ids } }]
        }).select('reservation reservations').lean() : [];
        const paidIds = new Set(deposits.flatMap(payment => [payment.reservation, ...(payment.reservations ?? [])]));

        return res.status(200).json({
            dashboard: {
                listedItems,
                itemsLent: {
                    timesLent: reservations.length,
                    distinctItems: new Set(reservations.map(reservation => reservation.item)).size
                },
                totalDepositsCollected: reservations.reduce((sum, reservation) =>
                    sum + (paidIds.has(reservation._id) ? reservation.payment?.depositAmount ?? 0 : 0), 0),
                damageIncidents: damagedReservations.length,
                damageIncidentRate: toPercent(damagedReservations.length, reservations.length)
            }
        });
    } catch (error) {
        next(error);
    }
}
