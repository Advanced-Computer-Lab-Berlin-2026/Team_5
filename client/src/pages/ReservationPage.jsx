import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { disputeDamageCase, damageCasePdfUrl, getDamageCaseForReservation } from '../api/damageReports.js';
import { markPickedUp, markReturnedGood, reportDamage, uploadConditionPhotos } from '../api/lenderReservations.js';
import { cancelReservation, getDelivery, getReservation, listMessages, requestExtension, sendMessage, updateDelivery } from '../api/reservations.js';
import { reviewBorrower, reviewLender } from '../api/reviews.js';
import { getItemCalendar } from '../api/items.js';
import { toKey } from '../components/Calendar.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { useAction } from '../hooks/useAction.js';
import { useAsync } from '../hooks/useAsync.js';
import { Button, Calendar, Card, ConfirmDialog, UserReviewsDialog, FileField, FileUploadCard, FormField, Message, PageHeader, ReservationCard, Spinner, StarRating } from '../components';
import { formatDate, formatDateTime } from '../utils/format.js';
import styles from './ReservationPage.module.css';

const STEPS = [['preparing', 'Preparing'], ['out-for-delivery', 'Out for delivery'], ['delivered', 'Delivered']];
const POLL_MS = 8000;
const isClosedChat = error => error.status === 403 && error.message === 'Chat is only available for upcoming or active reservations';

// Where a delivery is, as a line of three steps that fills in amber as it moves along.
// The lender (and admins) move it along by pressing a later step; it only goes forward, so steps already passed are locked.
// The borrower just watches it.
function DeliveryTracker({ id, data, canUpdate, reload }) {
    const change = useAction();
    const current = Math.max(0, STEPS.findIndex(([value]) => value === data.status));
    return <div className={styles.delivery}>
        <ol className={`${styles.steps} ${canUpdate ? styles.editable : ''}`} style={{ '--progress': current / (STEPS.length - 1) }}>
            {STEPS.map(([value, label], index) => <li key={value} className={`${styles.step} ${index <= current ? styles.done : ''}`} aria-current={index === current ? 'step' : undefined}>
                {canUpdate
                    ? <button type="button" className={styles.stepButton} disabled={change.pending || index <= current} aria-label={index < current ? `${label} (done)` : `Set the delivery to ${label}`}
                        onClick={async () => { if (await change.run(() => updateDelivery(id, value))) reload(); }}>
                        <span className={styles.stepDot} /> {label}
                    </button>
                    : <><span className={styles.stepDot} /> {label}</>}
            </li>)}
        </ol>
        {data.address && <p className={styles.muted}>To: {data.address}{data.fee ? ` (${data.fee} ₥)` : ''}</p>}
        <Message type="error">{change.error}</Message>
    </div>;
}

// The chat between the borrower and the lender. It checks for new messages every few seconds.
function Chat({ id, me, first, onClosed }) {
    const [messages, setMessages] = useState(first);
    const [error, setError] = useState('');
    const [text, setText] = useState('');
    const send = useAction();
    const endRef = useRef(null);
    const load = useCallback(() => listMessages(id)
        .then(data => { setMessages(data.messages ?? []); setError(''); })
        .catch(failure => {
            if (isClosedChat(failure)) onClosed();
            else setError(failure.message);
        }), [id, onClosed]);
    useEffect(() => {
        const timer = window.setInterval(load, POLL_MS);
        return () => window.clearInterval(timer);
    }, [load]);
    useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [messages.length]);

    async function handleSend(event) {
        event.preventDefault();
        if (!text.trim()) return;
        const sent = await send.run(async () => {
            try {
                return await sendMessage(id, text.trim());
            } catch (failure) {
                if (!isClosedChat(failure)) throw failure;
                onClosed();
                return false;
            }
        });
        if (sent) { setText(''); load(); }
    }

    return <div className={styles.chat}>
        <div className={styles.thread} role="log" aria-live="polite">
            {messages.length === 0 && !error && <p className={styles.muted}>No messages yet. Say hello.</p>}
            {messages.map(message => {
                const mine = message.sender === me;
                return <div key={message._id ?? `${message.date}${message.text}`} className={`${styles.row} ${mine ? styles.mineRow : ''}`}>
                    <span className={styles.avatar} title={message.sender} aria-hidden="true">{(message.sender || '?').charAt(0).toUpperCase()}</span>
                    <div className={`${styles.bubble} ${mine ? styles.mine : ''}`}>
                        <span className={styles.who}>{mine ? 'You' : message.sender}</span>
                        <span className={styles.text}>{message.text}</span>
                        <small>{formatDateTime(message.date)}</small>
                    </div>
                </div>;
            })}
            <div ref={endRef} />
        </div>
        <Message type="error">{error || send.error}</Message>
        <form className={styles.compose} onSubmit={handleSend}>
            <input aria-label="Message" placeholder="Write a message" maxLength={1000} value={text} onChange={event => setText(event.target.value)} />
            <Button type="submit" pending={send.pending} disabled={!text.trim()}>Send</Button>
        </form>
    </div>;
}


// Leave a rating (1 to 5 stars) and a few words about the other person. Only works once the reservation is completed.
function ReviewCard({ id, about, send }) {
    const review = useAction();
    const [rating, setRating] = useState(0);
    const [text, setText] = useState('');
    const [done, setDone] = useState(false);
    async function handleSubmit(event) {
        event.preventDefault();
        if (await review.run(() => send(id, { rating, review: text.trim() }))) setDone(true);
    }
    if (done) return <Card title={`Review for ${about}`}><Message type="success">Thank you. Your review was saved.</Message></Card>;
    return <Card title={`How was ${about}?`}>
        <form onSubmit={handleSubmit}>
            <StarRating value={rating} onChange={setRating} label={`Rating for ${about}`} />
            <FormField label="Your review" name="review" as="textarea" value={text} required maxLength={500} onChange={event => setText(event.target.value)} />
            {/* the server answers 409 when it was already reviewed, and that message is shown as it is */}
            <Message type="error">{review.error}</Message>
            <Button type="submit" pending={review.pending} disabled={!rating || !text.trim()}>Send review</Button>
        </form>
    </Card>;
}

// how a damage case reads to the borrower
const CASE_STATUS = { report: 'waiting for an admin', decision: 'decided, you can still dispute', dispute: 'disputed, waiting for the final ruling', resolution: 'final' };
const CASE_STEP = { report: 'Lender reported damage', decision: 'Admin decided', dispute: 'You disputed', resolution: 'Final ruling' };

// Borrower: the lender reported damage. The case number is the lender's report id; once the admin has ruled, the borrower
// has 7 days to dispute it with a message and photos. (The server does not show the case number to the borrower, so it is typed in.)
function DamageCase({ reservationId }) {
    const dispute = useAction();
    const { data: damageCase, error, reload } = useAsync(() => getDamageCaseForReservation(reservationId), [reservationId]);
    const caseNumber = damageCase?.id ?? '';
    const [message, setMessage] = useState('');
    const [files, setFiles] = useState([]);
    const valid = Boolean(caseNumber);
    return <Card title="Damage report" className={styles.damage}>
        <p className={styles.muted}>The lender reported damage when this item came back. Your deposit is held until an admin rules. If you disagree with the ruling you can dispute it within 7 days.</p>
        <form onSubmit={async event => { event.preventDefault(); if (await dispute.run(() => disputeDamageCase(caseNumber.trim(), message.trim(), files), 'Dispute sent. An admin will make the final ruling.')) { setMessage(''); setFiles([]); reload(); } }}>
            <Message type="error">{error}</Message>
            {damageCase && <>
                <p className={styles.muted}>Case {caseNumber} · {CASE_STATUS[damageCase.status] ?? damageCase.status}</p>
                <ol className={styles.caseSteps}>{damageCase.steps.map(step => <li key={step.type}><strong>{CASE_STEP[step.type] ?? step.type}</strong>{step.message ? ` — ${step.message}` : ''}{step.depositForfeit != null ? ` (${step.depositForfeit} ₥ kept from the deposit)` : ''}</li>)}</ol>
            </>}
            {damageCase?.canDispute && <><FormField label="Why do you disagree" name="disputeMessage" as="textarea" value={message} required onChange={event => setMessage(event.target.value)} />
            <FileField label="Photos (optional)" name="disputePhotos" accept="image/jpeg,image/png" multiple onChange={setFiles} /></>}
            <Message type="success">{dispute.success}</Message>
            <Message type="error">{dispute.error}</Message>
            <div className={styles.row}>
                {damageCase?.canDispute && <Button type="submit" pending={dispute.pending} disabled={!message.trim()}>Dispute the ruling</Button>}
                <Button variant="secondary" href={valid ? damageCasePdfUrl(caseNumber.trim()) : undefined} disabled={!valid} target="_blank" rel="noreferrer">Download the case PDF</Button>
            </div>
        </form>
    </Card>;
}

// Borrower (members), while the item is with them: ask the lender for more days on a small version of the calendar.
// The booking's last day is fixed as the start; pressing a later day picks the new last day. Days someone else has booked are red,
// and a range that runs into them cannot be sent (the server would refuse it). The lender accepts or declines on their Reservations page.
const dayOf = value => { const date = new Date(value); return toKey(new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())); };

function ExtensionCard({ reservation }) {
    const ask = useAction();
    const lastDay = dayOf(reservation.endDate);
    const [range, setRange] = useState({ start: lastDay, end: '' });
    const calendar = useAsync(() => getItemCalendar(reservation.item?._id ?? reservation.item), [reservation._id]);
    // the item's other bookings; this booking itself is left out so its own days are not shown as taken
    const others = (calendar.data?.reservations ?? []).filter(other => !(dayOf(other.startDate) === dayOf(reservation.startDate) && dayOf(other.endDate) === lastDay));
    const clash = range.end && others.some(other => dayOf(other.startDate) <= range.end && dayOf(other.endDate) > lastDay);
    return <Card title="Need it longer?" className={styles.extension}>
        <form onSubmit={async event => { event.preventDefault(); await ask.run(() => requestExtension(reservation._id, range.end), 'Asked. The lender will accept or decline, and you will get a notification.'); }}>
            <p className={styles.muted}>It is due back on {formatDate(reservation.endDate)}. Press the day you would like to bring it back instead.</p>
            <div className={styles.smallCalendar}><Calendar compact fixedStart={lastDay} minDate={lastDay} booked={others} value={range} onChange={setRange} /></div>
            {clash && <Message type="error">Someone has booked days before your new last day. Pick an earlier day.</Message>}
            <Message type="success">{ask.success}</Message>
            <Message type="error">{ask.error}</Message>
            {!ask.success && <Button type="submit" pending={ask.pending} disabled={!range.end || clash}>{range.end ? `Ask to keep it until ${formatDate(range.end)}` : 'Pick a new last day'}</Button>}
        </form>
    </Card>;
}

// Borrower: this reservation's status, with a way to cancel it until it starts, and the reviews and damage steps that apply.
function BorrowerPanel({ reservation, reload }) {
    const { role } = useAuth();
    const [reviewsOf, setReviewsOf] = useState('');
    const cancel = useAction();
    const [confirming, setConfirming] = useState(false);
    const cancellable = reservation.status === 'pending' || (reservation.status === 'upcoming' && new Date(reservation.startDate) > new Date());
    const reviewed = reservation.reviews?.lenderRating !== undefined;
    return <>
        <ReservationCard reservation={reservation} who={`Lent by ${reservation.lender}`}>
            <Button variant="secondary" size="small" onClick={() => setReviewsOf(reservation.lender)}>Lender's reviews</Button>
            {cancellable && <Button variant="destructive" size="small" onClick={() => setConfirming(true)}>Cancel reservation</Button>}
        </ReservationCard>
        <ConfirmDialog open={confirming} title="Cancel this reservation?" confirmLabel="Yes, cancel it" cancelLabel="Keep it" pending={cancel.pending} error={cancel.error}
            onConfirm={async () => { if (await cancel.run(() => cancelReservation(reservation._id), 'Reservation cancelled. Any refund is back in your wallet.')) { setConfirming(false); reload(); } }} onClose={() => setConfirming(false)}>
            Any refund goes back to your wallet.
        </ConfirmDialog>
        <Message type="success">{cancel.success}</Message>
        <UserReviewsDialog username={reviewsOf} onClose={() => setReviewsOf('')} />
        {reservation.status === 'active' && ['member', 'lender'].includes(role) && reservation.handover?.returnCondition !== 'damaged' && <ExtensionCard reservation={reservation} />}
        {reservation.status === 'completed' && !reviewed && <ReviewCard id={reservation._id} about={reservation.lender} send={reviewLender} />}
        {reservation.status === 'completed' && reviewed && <Card title={`Your review of ${reservation.lender}`}><StarRating readOnly value={reservation.reviews.lenderRating} label="Your rating" /><p className={styles.muted}>{reservation.reviews.lenderReview}</p></Card>}
        {reservation.handover?.returnCondition === 'damaged' && <DamageCase reservationId={reservation._id} />}
    </>;
}

// Lender only: the steps of handing the item over and getting it back. Only the step that is relevant now is shown:
//   upcoming -> hand over (pickup + pickup photos), active -> get it back (return, return photos, report damage), then done.
// The server has no "get one reservation", so the stage is remembered here and corrected when the server says it is wrong.
function LenderActions({ reservation, reload, delivery, reloadDelivery }) {
    const id = reservation._id;
    const stage = reservation.handover?.returnCondition === 'damaged' ? 'reported' : reservation.status;
    const [reviewsOpen, setReviewsOpen] = useState(false);
    const pickup = useAction();
    const giveBack = useAction();
    const damage = useAction();
    const [condition, setCondition] = useState('');
    const [message, setMessage] = useState('');
    const [files, setFiles] = useState([]);

    async function handlePickup() {
        // for a delivery booking, handing it over is also the delivery: the server keeps the two separate, so the status is updated here too
        const needsDelivery = delivery && delivery.status !== 'delivered';
        const ok = await pickup.run(async () => {
            await markPickedUp(id);
            if (needsDelivery) await updateDelivery(id, 'delivered');
        }, needsDelivery ? 'Marked as picked up and delivered.' : 'Marked as picked up.');
        if (ok) { reload(); if (needsDelivery) reloadDelivery(); }
    }
    // "Only upcoming reservations can ..." means it is already past pickup, so move on to the return step


    if (stage === 'reported') return <Card title="Damage reported"><p className={styles.muted}>The deposit stays held until an admin rules on the report.</p></Card>;
    if (stage === 'completed') return <>
        <Card title="All done"><p className={styles.muted}>This reservation is complete.</p></Card>
        <Button variant="secondary" onClick={() => setReviewsOpen(true)}>Borrower's reviews</Button>
        <UserReviewsDialog username={reviewsOpen ? reservation.borrower : ''} onClose={() => setReviewsOpen(false)} />
        {reservation.reviews?.borrowerRating == null ? <ReviewCard id={id} about="the borrower" send={reviewBorrower} /> : <Card title="Your review"><StarRating readOnly value={reservation.reviews.borrowerRating} label="Your rating" /><p>{reservation.reviews.borrowerReview}</p></Card>}
    </>;

    if (stage === 'upcoming') return <div className={styles.actionsGrid}>
        <Card title="Hand over" footer={<Button fullWidth pending={pickup.pending} onClick={handlePickup}>Mark as picked up</Button>}>
            <p className={styles.muted}>When the borrower has the item{delivery ? ', or it has been delivered' : ''}, mark it here.</p>
            <Message type="success">{pickup.success}</Message>
            <Message type="error">{pickup.error}</Message>
        </Card>
        <FileUploadCard title="Photos at pickup" name="pickup-photos" accept="image/jpeg,image/png" multiple hint="JPG or PNG, up to 5 MB each, at most 5."
            buttonText="Upload photos" onUpload={list => uploadConditionPhotos(id, 'pickup', list)} />
    </div>;

    if (stage !== 'active') return null;
    return <div className={styles.actionsGrid}>
        <Card title="Returned in good condition" footer={<Button fullWidth pending={giveBack.pending} onClick={async () => { if (await giveBack.run(() => markReturnedGood(id), 'Marked as returned. The deposit goes back to the borrower.')) reload(); }}>Mark as returned</Button>}>
            <p className={styles.muted}>When it is back and nothing is wrong. The deposit goes back to the borrower.</p>
            <Message type="success">{giveBack.success}</Message>
            <Message type="error">{giveBack.error}</Message>
        </Card>
        <FileUploadCard title="Photos at return" name="return-photos" accept="image/jpeg,image/png" multiple hint="JPG or PNG, up to 5 MB each, at most 5."
            buttonText="Upload photos" onUpload={list => uploadConditionPhotos(id, 'return', list)} />
        <Card title="Report damage" className={styles.damage}>
            <form onSubmit={async event => { event.preventDefault(); if (await damage.run(() => reportDamage(id, { returnCondition: condition, message }, files), 'Damage reported. The deposit stays held.')) reload(); }}>
                <FormField label="What is wrong" name="returnCondition" value={condition} required placeholder="Lens is scratched" onChange={event => setCondition(event.target.value)} />
                <FormField label="Details" name="damageMessage" as="textarea" value={message} required onChange={event => setMessage(event.target.value)} />
                <FileField label="Extra photos (optional)" name="damagePhotos" accept="image/jpeg,image/png" multiple onChange={setFiles} />
                <Message type="success">{damage.success}</Message>
                <Message type="error">{damage.error}</Message>
                <Button type="submit" pending={damage.pending}>Report damage</Button>
            </form>
        </Card>
    </div>;
}

export default function ReservationPage() {
    const { id } = useParams();
    const { role, user } = useAuth();
    const mine = useAsync(() => getReservation(id), [id]);
    const reservation = mine.data?.reservation;
    const chatAvailable = reservation?._id === id && ['upcoming', 'active'].includes(reservation.status);
    const chat = useAsync(() => chatAvailable
        ? listMessages(id).catch(error => {
            if (!isClosedChat(error)) throw error;
            mine.reload();
            return null;
        })
        : Promise.resolve(null), [id, chatAvailable, mine.reload]);
    const delivery = useAsync(() => getDelivery(id), [id]);
    const borrowerView = Boolean(reservation && reservation.borrower === user?.username);
    const lenderView = Boolean(reservation && reservation.lender === user?.username);
    // only the very first load shows a spinner; later reloads (after changing a delivery status) keep the page as it is
    if ((chat.loading && !chat.data && !chat.error) || (delivery.loading && !delivery.data && !delivery.error) || (mine.loading && !mine.data && !mine.error)) return <Spinner />;
    // only a booking that asked for delivery (it has an address) gets the delivery bar
    const hasDelivery = Boolean(delivery.data?.address);
    const notFound = Boolean(mine.error) && role !== 'admin';
    const waiting = !notFound && reservation?.status === 'pending';
    return <>
        <PageHeader title="Your reservation" backTo={borrowerView ? '/bookings' : role === 'lender' ? '/reservations' : '/items'} backLabel={borrowerView ? 'Back to my bookings' : role === 'lender' ? 'Back to reservations' : 'Back to catalog'} />
        <p className={styles.muted}>Reservation {id}</p>
        {notFound && <Message type="error">This reservation could not be found.</Message>}
        {borrowerView && reservation && <BorrowerPanel reservation={reservation} reload={mine.reload} />}
        {waiting && <Card title="Nothing to do yet"><p className={styles.muted}>Messages and delivery open once the owner approves the reservation, and close again when it is finished.</p></Card>}
        {hasDelivery && <Card title="Delivery"><DeliveryTracker id={id} data={delivery.data} canUpdate={role === 'admin' || lenderView} reload={delivery.reload} /></Card>}
        {chatAvailable && chat.data && <Card title="Messages">
            <Chat key={id} id={id} me={user?.username} first={chat.data.messages ?? []} onClosed={mine.reload} />
        </Card>}
        {chatAvailable && chat.error && <Message type="error">{chat.error}</Message>}
        {lenderView && <LenderActions key={id} reservation={reservation} reload={mine.reload} delivery={delivery.data} reloadDelivery={delivery.reload} />}
    </>;
}
