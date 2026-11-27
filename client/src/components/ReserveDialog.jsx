import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { addToBorrowList } from '../api/borrowList.js';
import { getItemCalendar } from '../api/items.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { announceBorrowListChange } from './BorrowBasket.jsx';
import { joinWaitlist } from '../api/waitlist.js';
import { useCardTilt } from '../hooks/useCardTilt.js';
import { useAction } from '../hooks/useAction.js';
import { Button } from './Button.jsx';
import { Calendar } from './Calendar.jsx';
import { FormField } from './FormField.jsx';
import { Message } from './Message.jsx';
import styles from './ReserveDialog.module.css';

// The amber card for booking an item: pick dates on the calendar and reserve.
// Reserve puts the item and dates on the borrow list (the basket), where everything is paid for at once from the wallet.
// "Dates taken? Join the waitlist" switches the calendar so red (booked) days can be picked, and joins the waitlist for them.
export function ReserveDialog({ item, open, onClose, onDatesChange }) {
    const dialog = useRef(null);
    useCardTilt(dialog);
    const { role } = useAuth();
    const canBook = role === 'member' || role === 'lender';
    const [waitMode, setWaitMode] = useState(false);
    const reserve = useAction();
    const waitlist = useAction();
    const [booked, setBooked] = useState([]);
    const [calendarError, setCalendarError] = useState('');
    const [range, setRange] = useState({ start: '', end: '' });
    const [delivery, setDelivery] = useState(false);
    const [address, setAddress] = useState('');
    const [clash, setClash] = useState(false);
    const [sent, setSent] = useState(false);

    useEffect(() => {
        const element = dialog.current;
        if (!element) return undefined;
        if (open) {
            delete element.dataset.closing;
            if (!element.open) element.showModal();
            return undefined;
        }
        if (!element.open) return undefined;
        element.dataset.closing = 'true';
        const timer = window.setTimeout(() => { element.close(); delete element.dataset.closing; }, 200);
        return () => window.clearTimeout(timer);
    }, [open]);

    useEffect(() => {
        if (!open) return;
        reserve.reset();
        setDelivery(false);
        setAddress('');
        setClash(false);
        setSent(false);
        setWaitMode(false);
        waitlist.reset();
        setRange({ start: '', end: '' });
        getItemCalendar(item._id).then(data => { setBooked(data.reservations ?? []); setCalendarError(''); }).catch(error => setCalendarError(error.message));
    }, [open, item._id]);

    const complete = range.start && range.end;
    const offersDelivery = item.delivery?.offered && !waitMode;
    async function handleReserve(event) {
        event.preventDefault();
        if (!canBook || !complete || waitMode || (delivery && !address.trim())) return;
        const result = await reserve.run(() => addToBorrowList(item._id, {
            startDate: range.start, endDate: range.end,
            deliveryAddress: delivery ? address.trim() : undefined
        }));
        if (result) {
            announceBorrowListChange();
            setSent(true);
            window.setTimeout(onClose, 3500);
        }
    }
    // the server answers 409 for taken dates; useAction keeps the message, so the clash is read from it
    useEffect(() => { setClash(/already reserved|not available/i.test(reserve.error)); }, [reserve.error]);
    const alreadyListed = /already in your borrow list/i.test(reserve.error);

    return (
        <dialog ref={dialog} className={styles.dialog} aria-label={`Reserve ${item.name}`}
            onCancel={event => { event.preventDefault(); onClose(); }} onClose={onClose}>
            <form onSubmit={handleReserve}>
                <h2>Reserve {item.name}</h2>
                <Calendar compact booked={booked} value={range} onChange={next => { setRange(next); if (next.start && next.end) onDatesChange?.({ startDate: next.start, endDate: next.end }); }} allowBooked={waitMode} />
                {waitMode && <p>Pick the days you want, including red ones. You will hear if they free up.</p>}
                <Message type="error">{calendarError}</Message>
                {offersDelivery && <div className={styles.deliveryBox}>
                    {/* a clear on/off button instead of a small checkbox; the address field opens under it when it is on */}
                    <button type="button" className={`${styles.deliveryToggle} ${delivery ? styles.deliveryOn : ''}`} aria-pressed={delivery} onClick={() => setDelivery(current => !current)}>
                        <span className={styles.check} aria-hidden="true">{delivery ? '✓' : ''}</span>
                        <span className={styles.deliveryText}><strong>Deliver it to me</strong><small>{item.delivery.fee ? `${item.delivery.fee} ₥ delivery fee, paid at checkout` : 'Free delivery'}</small></span>
                    </button>
                    {delivery && <FormField label="Delivery address" name="deliveryAddress" value={address} required placeholder="Street, number, city" onChange={event => setAddress(event.target.value)} />}
                </div>}
                <Message type="error">{reserve.error || waitlist.error}</Message>
                <Message type="success">{waitlist.success}</Message>
                {sent && <Message type="success">Added to your borrow list. <Link to="/borrow-list">Go to checkout</Link> when you are ready to pay.</Message>}
                {alreadyListed && <Message type="info">It is on your borrow list already. <Link to={`/borrow-list?edit=${encodeURIComponent(item._id)}`}>Change its dates</Link>.</Message>}
                {sent ? null : (clash || waitMode)
                    ? <Button type="button" fullWidth pending={waitlist.pending} disabled={!complete || Boolean(waitlist.success)}
                        onClick={() => waitlist.run(() => joinWaitlist(item._id, { startDate: range.start, endDate: range.end }), 'You are on the waitlist. If those days free up you get a notification (Premium members are told first, then Plus, then Basic).')}>
                        Join the waitlist for these dates
                    </Button>
                    : <Button type="submit" fullWidth pending={reserve.pending} disabled={!canBook || !complete || (delivery && !address.trim())}>
                        Reserve
                    </Button>}
                {/* the waitlist switch and Cancel share one line, so the card stays short enough to fit without scrolling */}
                <div className={`${styles.footer} ${styles.footerRow}`}>
                    {!sent && !clash ? <button type="button" className={styles.textButton} onClick={() => { setWaitMode(mode => !mode); setRange({ start: '', end: '' }); waitlist.reset(); reserve.reset(); }}>
                        {waitMode ? 'Back to reserving' : 'Dates taken? Join the waitlist'}
                    </button> : <span />}
                    <button type="button" className={styles.textButton} onClick={onClose}>Cancel</button>
                </div>
            </form>
        </dialog>
    );
}
