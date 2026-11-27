import { useState } from 'react';
import { cancelReservation, getMyReservations } from '../api/reservations.js';
import { useAction } from '../hooks/useAction.js';
import { useAsync } from '../hooks/useAsync.js';
import { Button, ConfirmDialog, EmptyState, Grid, Icon, ItemCard, Message, PageHeader, Select, Spinner } from '../components';
import { STATUS_LABELS } from '../components/ReservationCard.jsx';
import { toKey } from '../components/Calendar.jsx';
import { formatDate } from '../utils/format.js';
import styles from './MyBookingsPage.module.css';

const VIEWS = [['upcoming', 'Coming up'], ['past', 'Past']].map(([value, label]) => ({ value, label }));

// A booking can be cancelled until it starts, while the owner has not handed the item over yet
const canCancel = reservation => ['pending', 'upcoming'].includes(reservation.status) && new Date(reservation.startDate) > new Date();

export default function MyBookingsPage() {
    const [view, setView] = useState('upcoming');
    // the server's "upcoming" view is every pending, approved or active booking whatever its dates, so a request the owner never
    // answered stays in it forever. Both views are loaded and a pending request whose start date has passed is moved to Past as "expired".
    const { data: all, error, loading, reload } = useAsync(async () => {
        const [coming, past] = await Promise.all([getMyReservations({ view: 'upcoming' }), getMyReservations({ view: 'past' })]);
        return [...coming.reservations, ...past.reservations];
    });
    // Dates are whole days (stored as midnight UTC), so a request only counts as unanswered once its start DAY is over.
    // Comparing with the exact time made a booking that starts today (paid at checkout a moment ago) jump straight to Past.
    const today = toKey(new Date());
    const startDay = reservation => { const date = new Date(reservation.startDate); return toKey(new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())); };
    const expired = reservation => reservation.status === 'pending' && startDay(reservation) < today;
    const data = all && { reservations: all
        .filter(reservation => (view === 'past') === (['completed', 'cancelled', 'rejected'].includes(reservation.status) || expired(reservation)))
        .map(reservation => (expired(reservation) ? { ...reservation, status: 'expired' } : reservation))
        .sort((a, b) => (view === 'past' ? new Date(b.startDate) - new Date(a.startDate) : new Date(a.startDate) - new Date(b.startDate))) };
    const cancel = useAction();
    // the booking the person pressed Cancel on; the question is asked in a card in the middle of the screen
    const [target, setTarget] = useState(null);

    async function handleCancel() {
        const result = await cancel.run(() => cancelReservation(target._id), 'Reservation cancelled. Any refund is back in your wallet.');
        if (result) { setTarget(null); reload(); }
    }

    return <>
        <PageHeader title="My bookings" />
        <div className={styles.filter}><Select name="view" aria-label="Show" value={view} options={VIEWS} onChange={event => setView(event.target.value)} /></div>
        {loading && !data && <Spinner />}
        <Message type="error">{error || cancel.error}</Message>
        {cancel.success && <Message type="success">{cancel.success}</Message>}
        {data?.reservations.length === 0 && <EmptyState featured={view === 'upcoming'} icon="box"
            title={view === 'upcoming' ? 'Nothing booked yet' : 'No past reservations'}
            description={view === 'upcoming' ? 'Find something to borrow and send the owner a request. It shows up here while you wait.' : 'Finished, cancelled and declined bookings are kept here.'}
            action={view === 'upcoming' ? <Button to="/items">Start discovering <Icon name="arrow" size={16} /></Button> : undefined} />}
        <Grid>
            {data?.reservations.map((reservation, index) => {
                return <ItemCard key={reservation._id} item={{ photos: [], ...reservation.item, name: reservation.item?.name ?? 'Item no longer listed', _id: reservation.item?._id ?? reservation._id }}
                    introDelay={index * 60} showView={false} plainBack
                    tag={{ label: STATUS_LABELS[reservation.status] ?? reservation.status, tone: ['upcoming', 'active'].includes(reservation.status) ? 'amber' : ['cancelled', 'rejected', 'expired'].includes(reservation.status) ? 'muted' : undefined }}
                    subtitle={`${formatDate(reservation.startDate)} to ${formatDate(reservation.endDate)}`}
                    extra={`${formatDate(reservation.startDate)} to ${formatDate(reservation.endDate)}`}
                    details={[['Lent by', reservation.lender], ['Status', STATUS_LABELS[reservation.status] ?? reservation.status]]}
                    actions={<>
                        <Button size="small" to={`/reservations/${reservation._id}`}>Open <Icon name="arrow" size={16} /></Button>
                        {canCancel(reservation) && <Button variant="destructive" size="small" onClick={() => { cancel.reset(); setTarget(reservation); }}>Cancel</Button>}
                    </>} />;
            })}
        </Grid>
        <ConfirmDialog open={Boolean(target)} title="Cancel this booking?" confirmLabel="Yes, cancel it" cancelLabel="Keep it"
            pending={cancel.pending} error={cancel.error} onConfirm={handleCancel} onClose={() => setTarget(null)}>
            {target && <>{target.item?.name ?? 'This item'}, {formatDate(target.startDate)} to {formatDate(target.endDate)}. {target.status === 'pending' ? 'The owner has not answered yet.' : 'The owner already approved it.'} Any refund goes back to your wallet.</>}
        </ConfirmDialog>
    </>;
}
