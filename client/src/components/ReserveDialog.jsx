import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { addToBorrowList } from '../api/borrowList.js';
import { getItemCalendar } from '../api/items.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { announceBorrowListChange } from './BorrowBasket.jsx';
import { createReservation } from '../api/reservations.js';
import { joinWaitlist } from '../api/waitlist.js';
import { useCardTilt } from '../hooks/useCardTilt.js';
import { useAction } from '../hooks/useAction.js';
import { Button } from './Button.jsx';
import { Calendar } from './Calendar.jsx';
import { FormField } from './FormField.jsx';
import { Message } from './Message.jsx';
import styles from './ReserveDialog.module.css';

// The amber card for booking an item: pick dates on the calendar and reserve.
// A member's Reserve puts the item and dates on their borrow list, where everything is paid for at once (wallet or card).
// A lender cannot use that checkout (the server allows members only), so a lender's Reserve still sends the request straight away,
// with the optional delivery. If the dates are taken (409) the same card offers the waitlist instead.
export function ReserveDialog({ item, open, onClose }) {
    const dialog = useRef(null);
    useCardTilt(dialog);
    const { role } = useAuth();
    const viaList = role === 'member';
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
        setClash(false);
        setSent(false);
        setRange({ start: '', end: '' });
        getItemCalendar(item._id).then(data => { setBooked(data.reservations ?? []); setCalendarError(''); }).catch(error => setCalendarError(error.message));
    }, [open, item._id]);

    const complete = range.start && range.end;
    // the checkout has no delivery option yet, so only the direct request (lenders) can ask for delivery
    const offersDelivery = item.delivery?.offered && !viaList;

    async function handleReserve(event) {
        event.preventDefault();
        const result = await reserve.run(() => (viaList
            ? addToBorrowList(item._id, { startDate: range.start, endDate: range.end })
            : createReservation({ itemId: item._id, startDate: range.start, endDate: range.end, deliveryFlag: delivery, deliveryAddress: address })));
        // the request goes to the owner, who has to accept it. Stay on this page and close the card shortly after
        if (result && viaList) announceBorrowListChange();
        if (result) { setSent(true); window.setTimeout(onClose, 3500); }
    }
    // the server answers 409 for taken dates; useAction keeps the message, so the clash is read from it
    useEffect(() => { setClash(/already reserved|not available/i.test(reserve.error)); }, [reserve.error]);
    const alreadyListed = /already in your borrow list/i.test(reserve.error);

    return (
        <dialog ref={dialog} className={styles.dialog} aria-label={`Reserve ${item.name}`}
            onCancel={event => { event.preventDefault(); onClose(); }} onClose={onClose}>
            <form onSubmit={handleReserve}>
                <h2>Reserve {item.name}</h2>
                <Calendar booked={booked} value={range} onChange={setRange} />
                <Message type="error">{calendarError}</Message>
                {offersDelivery && (
                    <label className={styles.toggle}>
                        <input type="checkbox" checked={delivery} onChange={event => setDelivery(event.target.checked)} />
                        Deliver it to me ({item.delivery.fee} ₥)
                    </label>
                )}
                {delivery && <FormField label="Delivery address" name="deliveryAddress" value={address} required onChange={event => setAddress(event.target.value)} />}
                <Message type="error">{reserve.error || waitlist.error}</Message>
                <Message type="success">{waitlist.success}</Message>
                {sent && (viaList
                    ? <Message type="success">Added to your borrow list. <Link to="/borrow-list">Go to checkout</Link> when you are ready to pay.</Message>
                    : <Message type="success">Request sent. The owner will get back to you. <Link to="/bookings">View my bookings</Link></Message>)}
                {alreadyListed && <Message type="info">It is on your borrow list already. <Link to="/borrow-list">Change its dates there</Link>.</Message>}
                {sent ? null : clash
                    ? <Button type="button" fullWidth pending={waitlist.pending} disabled={!complete}
                        onClick={() => waitlist.run(() => joinWaitlist(item._id, { startDate: range.start, endDate: range.end }), 'You are on the waitlist for those dates.')}>
                        Join the waitlist for these dates
                    </Button>
                    : <Button type="submit" fullWidth pending={reserve.pending} disabled={!complete || (delivery && !address)}>
                        Reserve
                    </Button>}
                <div className={styles.footer}>
                    <button type="button" className={styles.textButton} onClick={onClose}>Cancel</button>
                </div>
            </form>
        </dialog>
    );
}
