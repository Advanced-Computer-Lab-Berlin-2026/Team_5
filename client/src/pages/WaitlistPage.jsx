import { addToBorrowList } from '../api/borrowList.js';
import { getWaitlist, leaveWaitlist } from '../api/waitlist.js';
import { announceBorrowListChange } from '../components/BorrowBasket.jsx';
import { useAction } from '../hooks/useAction.js';
import { useAsync } from '../hooks/useAsync.js';
import { Button, EmptyState, Grid, Icon, ItemCard, Message, PageHeader, Spinner } from '../components';
import { toKey } from '../components/Calendar.jsx';
import { formatDate } from '../utils/format.js';
import styles from './WaitlistPage.module.css';

const dayOf = value => { const date = new Date(value); return toKey(new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())); };

// Members and lenders: the dates they are waiting for on items that were booked. When a booking is cancelled the server picks
// who is told first (Premium, then Plus, then Basic, then whoever joined first); that entry shows "Free now" here and can go
// straight into the basket.
export default function WaitlistPage() {
    const { data, error, loading, reload } = useAsync(getWaitlist);
    const act = useAction();
    const today = toKey(new Date());
    const entries = (data?.waitlists ?? []).filter(entry => entry.item);

    async function reserve(entry) {
        const ok = await act.run(() => addToBorrowList(entry.item._id, { startDate: dayOf(entry.startDate), endDate: dayOf(entry.endDate) }),
            `${entry.item.name} is in your basket. Go to checkout to finish your reservation.`);
        if (ok) { announceBorrowListChange(); reload(); }
    }

    return <>
        <PageHeader title="Waitlist" />
        <p className={styles.lead}>Items you are waiting for. If the booking in your way is cancelled, you get a notification; Premium members are told first, then Plus, then Basic.</p>
        {loading && !data && <Spinner />}
        <Message type="error">{error || act.error}</Message>
        <Message type="success">{act.success}</Message>
        {data && entries.length === 0 && <EmptyState featured icon="box" title="You are not waiting for anything"
            description="When the dates you want are taken, open Reserve on the item and choose “Dates taken? Join the waitlist”."
            action={<Button to="/items">Start discovering <Icon name="arrow" size={16} /></Button>} />}
        <Grid>
            {entries.map((entry, index) => {
                const free = entry.canReserve;
                const over = dayOf(entry.startDate) < today;
                const dates = `${formatDate(entry.startDate)} to ${formatDate(entry.endDate)}`;
                return <ItemCard key={entry._id} item={entry.item} introDelay={index * 60} plainBack
                    tag={over ? { label: 'Dates passed', tone: 'muted' } : free ? { label: 'Free now', tone: 'amber' } : { label: 'Waiting' }}
                    subtitle={dates} extra={dates}
                    details={[['Status', over ? 'These dates have passed' : free ? 'Availability notice sent' : 'Waiting for availability']]}
                    actions={<>
                        {free && !over && <Button size="small" pending={act.pending} onClick={() => reserve(entry)}>Reserve these dates</Button>}
                        <Button variant="destructive" size="small" disabled={act.pending}
                            onClick={async () => { if (await act.run(() => leaveWaitlist(entry._id), 'You left the waitlist.')) reload(); }}>Leave</Button>
                    </>} />;
            })}
        </Grid>
    </>;
}
