import { useEffect } from 'react';
import { listAcceptedReservations, listCompletedReservations } from '../api/lenderReservations.js';
import { useAsync } from '../hooks/useAsync.js';
import { formatDate } from '../utils/format.js';
import { Button } from './Button.jsx';
import { Grid } from './Grid.jsx';
import { Icon } from './Icon.jsx';
import { ItemCard } from './ItemCard.jsx';
import { Message } from './Message.jsx';
import { STATUS_LABELS } from './ReservationCard.jsx';
import styles from './IncomingRequests.module.css';

// fired after the lender approves a request or accepts more days, so the Accepted list on the same page refreshes straight away
export const LENDER_BOOKINGS_CHANGED = 'acl:lender-bookings-changed';
export const announceLenderBookingsChange = () => window.dispatchEvent(new Event(LENDER_BOOKINGS_CHANGED));

// Lender: the bookings they approved (still to hand over) and the ones out with a borrower now, as tilting item cards.
// Opening one leads to its reservation page with the handover, return, chat and delivery steps.
export function AcceptedBookings({ completed = false }) {
    const { data, error, reload } = useAsync(completed ? listCompletedReservations : listAcceptedReservations, [completed]);
    useEffect(() => {
        window.addEventListener(LENDER_BOOKINGS_CHANGED, reload);
        return () => window.removeEventListener(LENDER_BOOKINGS_CHANGED, reload);
    }, [reload]);
    const bookings = data?.reservations ?? [];
    if (!bookings.length && !error) return null;
    const borrower = booking => booking.borrower?.profile?.name ?? booking.borrower?.username ?? booking.borrower?._id ?? booking.borrower;
    return <section className={styles.section} aria-label={completed ? 'Completed bookings' : 'Accepted bookings'}>
        <h2>{completed ? 'Completed' : 'Accepted'} <span className={styles.count}>{bookings.length}</span></h2>
        <Message type="error">{error}</Message>
        <Grid>
            {bookings.map((booking, index) => {
                const dates = `${formatDate(booking.startDate)} to ${formatDate(booking.endDate)}`;
                return <ItemCard key={booking._id} introDelay={index * 60} showView={false} plainBack
                    item={{ photos: [], ...booking.item, name: booking.item?.name ?? 'Item no longer listed', _id: booking.item?._id ?? booking._id, depositAmount: booking.payment?.depositAmount ?? 0 }}
                    tag={{ label: STATUS_LABELS[booking.status] ?? booking.status, tone: 'amber' }}
                    deposit={booking.payment?.depositAmount ?? 0}
                    subtitle={dates} extra={dates}
                    details={[['Borrower', borrower(booking)], ['Delivery', booking.delivery?.address ? 'Yes' : 'Pickup']]}
                    actions={<Button size="small" to={`/reservations/${booking._id}`}>Open <Icon name="arrow" size={16} /></Button>} />;
            })}
        </Grid>
    </section>;
}
