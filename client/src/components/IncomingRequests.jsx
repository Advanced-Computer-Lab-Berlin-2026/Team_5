import { useMemo, useState } from 'react';
import { getItemCalendar } from '../api/items.js';
import { approveReservation, listIncomingReservations, rejectReservation } from '../api/lenderReservations.js';
import { useAction } from '../hooks/useAction.js';
import { useAsync } from '../hooks/useAsync.js';
import { formatDate } from '../utils/format.js';
import { Button } from './Button.jsx';
import { Calendar, toKey } from './Calendar.jsx';
import { ItemImage } from './ItemImage.jsx';
import { Message } from './Message.jsx';
import TiltedCard from './TiltedCard.jsx';
import { UserReviewsDialog } from './UserReviewsDialog.jsx';
import { announceLenderBookingsChange } from './AcceptedBookings.jsx';
import itemStyles from './ItemCard.module.css';
import styles from './IncomingRequests.module.css';

// the server stores dates at midnight UTC; the calendar works in plain YYYY-MM-DD days
const dayKey = value => { const date = new Date(value); return toKey(new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())); };
const borrowerUsername = request => request.borrower?.username ?? request.borrower?._id ?? request.borrower;
const borrowerName = request => request.borrower?.profile?.name ?? request.borrower?.username ?? request.borrower?._id ?? request.borrower;

// One item, on a row of its own: the item card (like the ones on My items) on the left, and on the right, in two thirds of the row,
// a month showing every request for it (amber) next to the dates already booked, with the requests listed to answer.
// Pressing a requested date lights up the request(s) for that date; pressing a request lights up its dates.
function RequestRow({ item, requests, busyId, disabled, onDecide, index }) {
    const [activeIds, setActiveIds] = useState(() => [requests[0]._id]);
    const [reviewsOf, setReviewsOf] = useState('');
    const calendar = useAsync(() => getItemCalendar(item._id), [item._id]);
    const ranges = useMemo(() => requests.map(request => ({ id: request._id, start: dayKey(request.startDate), end: dayKey(request.endDate) })), [requests]);
    const name = item.name ?? 'Item no longer listed';
    // a request that was just answered is gone from the list, so only the ones still there count as lit
    const lit = activeIds.filter(id => requests.some(request => request._id === id));
    const shown = lit.length ? lit : [requests[0]._id];

    // approving blocks those dates, so the booked dates are loaded again once an answer has gone through
    const decide = (id, approve) => onDecide(id, approve).then(ok => { if (ok) calendar.reload(); });
    const booked = calendar.data?.reservations ?? [];

    return <div className={styles.row}>
        <TiltedCard altText={name} showTooltip={false} containerWidth="100%" containerHeight="auto" imageWidth="100%" imageHeight="100%"
            style={{ aspectRatio: '3 / 4' }} radius={12} rotateAmplitude={10} scaleOnHover={1.04} glare={0.35} shadow={0.35} parallax={0}
            introDelay={index * 60}>
            <div className={itemStyles.face}>
                <ItemImage src={item.photos?.[0]?.url} alt={name} className={itemStyles.image} />
                <span className={styles.badge}>{requests.length} {requests.length === 1 ? 'request' : 'requests'}</span>
                <div className={itemStyles.body}>
                    <h2 className={itemStyles.title}>{name}</h2>
                </div>
            </div>
        </TiltedCard>
        {/* the panel is as tall as the item card and stays that size: more requests just make its list scroll */}
        <div className={styles.panelWrap}>
            <TiltedCard altText={`Requests for ${name}`} showTooltip={false} containerWidth="100%" containerHeight="100%" imageWidth="100%" imageHeight="100%"
                radius={12} rotateAmplitude={2.5} scaleOnHover={1} glare={0.12} shadow={0.3} parallax={0} introDelay={index * 60 + 80}>
                <div className={styles.panel}>
                    <div className={styles.calendar}>
                        <Calendar key={shown[0]} readOnly ranges={ranges} activeIds={shown} onDayClick={(key, ids) => setActiveIds(ids)} booked={booked} />
                        {booked.length > 0 && <p className={styles.bookedList}><strong>Already booked</strong> {booked.slice(0, 6).map(range => `${formatDate(range.startDate)} to ${formatDate(range.endDate)}`).join(' · ')}{booked.length > 6 ? ` · and ${booked.length - 6} more` : ''}</p>}
                        {calendar.error && <p className={styles.note}>Booked dates could not be loaded.</p>}
                    </div>
                    <ul className={styles.requests} aria-label={`Requests for ${name}`}>
                        {requests.map(request => <li key={request._id} className={`${styles.request} ${shown.includes(request._id) ? styles.lit : ''}`}>
                            <button type="button" className={styles.pick} onClick={() => setActiveIds([request._id])} aria-pressed={shown.includes(request._id)}>
                                <strong>{borrowerName(request)}</strong>
                                <span>{formatDate(request.startDate)} to {formatDate(request.endDate)}</span>
                            </button>
                            <button type="button" className={styles.reviewsLink} onClick={() => setReviewsOf(borrowerUsername(request))}>See {borrowerName(request)}'s reviews</button>
                            <div className={styles.buttons}>
                                <Button pending={busyId === request._id} disabled={disabled} onClick={() => decide(request._id, true)}>Approve</Button>
                                <Button variant="secondary" disabled={disabled} onClick={() => decide(request._id, false)}>Decline</Button>
                            </div>
                        </li>)}
                    </ul>
                </div>
            </TiltedCard>
        </div>
        <UserReviewsDialog username={reviewsOf} onClose={() => setReviewsOf('')} />
    </div>;
}

// Lender: the pending requests for their items, one row per item. Renders nothing when there are none.
export function IncomingRequests() {
    const { data, error, reload } = useAsync(listIncomingReservations);
    const decide = useAction();
    const [busyId, setBusyId] = useState('');

    async function handle(id, approve) {
        setBusyId(id);
        const ok = await decide.run(() => (approve ? approveReservation(id) : rejectReservation(id)),
            approve ? 'Approved. The borrower has been told, and the dates are now blocked.' : 'Declined. The deposit went back to the borrower.');
        setBusyId('');
        if (ok) { reload(); if (approve) announceLenderBookingsChange(); }
        return ok;
    }

    // a request whose start day is already over cannot happen any more, so it is not offered for approval
    const today = toKey(new Date());
    const requests = (data?.reservations ?? []).filter(request => dayKey(request.startDate) >= today);
    const groups = useMemo(() => {
        const byItem = new Map();
        for (const request of requests) {
            const id = request.item?._id ?? request._id;
            if (!byItem.has(id)) byItem.set(id, { item: request.item ?? { _id: id }, requests: [] });
            byItem.get(id).requests.push(request);
        }
        return [...byItem.values()];
    }, [requests]);
    if (!requests.length && !error && !decide.success && !decide.error) return null;
    return <section className={styles.section} aria-label="Requests">
        <h2>Requests <span className={styles.count}>{requests.length}</span></h2>
        <Message type="error">{error || decide.error}</Message>
        <Message type="success">{decide.success}</Message>
        <div className={styles.list}>
            {groups.map((group, index) => <RequestRow key={group.item._id} index={index} item={group.item} requests={group.requests} busyId={decide.pending ? busyId : ''} disabled={decide.pending} onDecide={handle} />)}
        </div>
    </section>;
}
