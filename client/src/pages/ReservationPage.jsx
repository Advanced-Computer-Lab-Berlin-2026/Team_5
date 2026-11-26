import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { markPickedUp, markReturnedGood, reportDamage, uploadConditionPhotos } from '../api/lenderReservations.js';
import { getDelivery, listMessages, sendMessage, updateDelivery } from '../api/reservations.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useAction } from '../hooks/useAction.js';
import { useAsync } from '../hooks/useAsync.js';
import { Button, Card, FileField, FileUploadCard, FormField, Message, PageHeader, Spinner } from '../components';
import { formatDateTime } from '../utils/format.js';
import styles from './ReservationPage.module.css';

const STEPS = [['preparing', 'Preparing'], ['out-for-delivery', 'Out for delivery'], ['delivered', 'Delivered']];
const POLL_MS = 8000;
const CHAT_CLOSED = 'Chat is only available for upcoming or active reservations';

// Where a delivery is, as a line of three steps that fills in amber as it moves along.
function DeliveryTracker({ id, data, canUpdate, reload }) {
    const change = useAction();
    const current = Math.max(0, STEPS.findIndex(([value]) => value === data.status));
    return <div className={styles.delivery}>
        <ol className={styles.steps} style={{ '--progress': current / (STEPS.length - 1) }}>
            {STEPS.map(([value, label], index) => <li key={value} className={`${styles.step} ${index <= current ? styles.done : ''}`} aria-current={index === current ? 'step' : undefined}>
                <span className={styles.stepDot} /> {label}
            </li>)}
        </ol>
        {data.address && <p className={styles.muted}>To: {data.address}{data.fee ? ` (${data.fee} ₥)` : ''}</p>}
        <Message type="error">{change.error}</Message>
        {canUpdate && <div className={styles.row}>
            {STEPS.map(([value, label]) => <Button key={value} variant="secondary" size="small" disabled={change.pending || value === data.status}
                onClick={async () => { if (await change.run(() => updateDelivery(id, value))) reload(); }}>{label}</Button>)}
        </div>}
    </div>;
}

// The chat between the borrower and the lender. It checks for new messages every few seconds.
function Chat({ id, me, first }) {
    const [messages, setMessages] = useState(first);
    const [error, setError] = useState('');
    const [text, setText] = useState('');
    const send = useAction();
    const endRef = useRef(null);
    const load = useCallback(() => listMessages(id).then(data => { setMessages(data.messages ?? []); setError(''); }).catch(failure => setError(failure.message)), [id]);
    useEffect(() => {
        const timer = window.setInterval(load, POLL_MS);
        return () => window.clearInterval(timer);
    }, [load]);
    useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [messages.length]);

    async function handleSend(event) {
        event.preventDefault();
        if (!text.trim()) return;
        if (await send.run(() => sendMessage(id, text.trim()))) { setText(''); load(); }
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

// Lender only: the steps of handing the item over and getting it back. Only the step that is relevant now is shown:
//   upcoming -> hand over (pickup + pickup photos), active -> get it back (return, return photos, report damage), then done.
// The server has no "get one reservation", so the stage is remembered here and corrected when the server says it is wrong.
const stageKey = id => `acl.reservation-stage.${id}`;
const readStage = id => { try { return window.localStorage.getItem(stageKey(id)) || 'upcoming'; } catch { return 'upcoming'; } };
const saveStage = (id, stage) => { try { window.localStorage.setItem(stageKey(id), stage); } catch { /* the page still works without it */ } };

function LenderActions({ id, delivery, reloadDelivery }) {
    const [stage, setStageState] = useState(() => readStage(id));
    const setStage = next => { saveStage(id, next); setStageState(next); };
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
        if (ok) { setStage('active'); if (needsDelivery) reloadDelivery(); }
    }
    // "Only upcoming reservations can ..." means it is already past pickup, so move on to the return step
    useEffect(() => { if (/only upcoming/i.test(pickup.error)) setStage('active'); }, [pickup.error]);

    if (stage === 'done') return <Card title="All done"><p className={styles.muted}>This reservation is complete.</p></Card>;

    if (stage === 'upcoming') return <div className={styles.actionsGrid}>
        <Card title="Hand over">
            <Message type="success">{pickup.success}</Message>
            <Message type="error">{pickup.error}</Message>
            <Button fullWidth pending={pickup.pending} onClick={handlePickup}>Mark as picked up</Button>
        </Card>
        <FileUploadCard title="Photos at pickup" name="pickup-photos" accept="image/jpeg,image/png" multiple hint="JPG or PNG, up to 5 MB each, at most 5."
            buttonText="Upload photos" onUpload={list => uploadConditionPhotos(id, 'pickup', list)} />
    </div>;

    return <div className={styles.actionsGrid}>
        <Card title="Returned in good condition">
            <Message type="success">{giveBack.success}</Message>
            <Message type="error">{giveBack.error}</Message>
            <Button fullWidth pending={giveBack.pending} onClick={async () => { if (await giveBack.run(() => markReturnedGood(id), 'Marked as returned. The deposit goes back to the borrower.')) setStage('done'); }}>Mark as returned</Button>
        </Card>
        <FileUploadCard title="Photos at return" name="return-photos" accept="image/jpeg,image/png" multiple hint="JPG or PNG, up to 5 MB each, at most 5."
            buttonText="Upload photos" onUpload={list => uploadConditionPhotos(id, 'return', list)} />
        <Card title="Report damage" className={styles.damage}>
            <form onSubmit={async event => { event.preventDefault(); if (await damage.run(() => reportDamage(id, { returnCondition: condition, message }, files), 'Damage reported. The deposit stays held.')) setStage('done'); }}>
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
    // Chat only works for upcoming or active reservations (the server answers 403 otherwise), and a delivery only exists for
    // reservations that asked for one (404 otherwise). So a section is shown only when the server says it can be used.
    const chat = useAsync(() => listMessages(id), [id]);
    const delivery = useAsync(() => getDelivery(id), [id]);
    // only the very first load shows a spinner; later reloads (after changing a delivery status) keep the page as it is
    if ((chat.loading && !chat.data && !chat.error) || (delivery.loading && !delivery.data && !delivery.error)) return <Spinner />;
    const chatOpen = Boolean(chat.data);
    const hasDelivery = Boolean(delivery.data);
    const notFound = chat.error && chat.error !== CHAT_CLOSED && /not found/i.test(chat.error);
    const waiting = !chatOpen && !hasDelivery && !notFound;
    return <>
        <PageHeader title="Your reservation" backTo="/items" backLabel="Back to catalog" />
        <p className={styles.muted}>Reservation {id}</p>
        {notFound && <Message type="error">This reservation could not be found.</Message>}
        {waiting && <Card title="Nothing to do yet"><p className={styles.muted}>Messages and delivery open once the owner approves the reservation, and close again when it is finished.</p></Card>}
        {hasDelivery && <Card title="Delivery"><DeliveryTracker id={id} data={delivery.data} canUpdate={role === 'lender' || role === 'admin'} reload={delivery.reload} /></Card>}
        {chatOpen && <Card title="Messages"><Chat id={id} me={user?.username} first={chat.data.messages ?? []} /></Card>}
        {chatOpen && role === 'lender' && <LenderActions id={id} delivery={delivery.data} reloadDelivery={delivery.reload} />}
    </>;
}
