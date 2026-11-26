import { useEffect, useRef, useState } from 'react';
import { getItemCalendar } from '../api/items.js';
import { createReservation } from '../api/reservations.js';
import { joinWaitlist } from '../api/waitlist.js';
import { useCardTilt } from '../hooks/useCardTilt.js';
import { useAction } from '../hooks/useAction.js';
import { Button } from './Button.jsx';
import { Calendar } from './Calendar.jsx';
import { FormField } from './FormField.jsx';
import { Message } from './Message.jsx';
import styles from './ReserveDialog.module.css';

// The amber card for booking an item: pick dates on the calendar, optionally ask for delivery, and reserve.
// If the dates are taken (409) the same card offers to put you on the waitlist for them instead.
export function ReserveDialog({ item, open, onClose }) {
    const dialog = useRef(null);
    useCardTilt(dialog);
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
    const offersDelivery = item.delivery?.offered;

    async function handleReserve(event) {
        event.preventDefault();
        const result = await reserve.run(() => createReservation({ itemId: item._id, startDate: range.start, endDate: range.end, deliveryFlag: delivery, deliveryAddress: address }));
        // the request goes to the owner, who has to accept it. Stay on this page and close the card shortly after
        if (result) { setSent(true); window.setTimeout(onClose, 1800); }
    }
    // the server answers 409 for taken dates; useAction keeps the message, so the clash is read from it
    useEffect(() => { setClash(/already reserved/i.test(reserve.error)); }, [reserve.error]);

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
                {sent && <Message type="success">Request sent. The owner will get back to you.</Message>}
                {sent ? null : clash
                    ? <Button type="button" fullWidth pending={waitlist.pending} disabled={!complete}
                        onClick={() => waitlist.run(() => joinWaitlist(item._id, { startDate: range.start, endDate: range.end }), 'You are on the waitlist for those dates.')}>
                        Join the waitlist for these dates
                    </Button>
                    : <Button type="submit" fullWidth pending={reserve.pending} disabled={!complete || (delivery && !address)}>
                        {complete ? `Reserve for ${range.start} to ${range.end}` : 'Pick your dates'}
                    </Button>}
                <div className={styles.footer}>
                    <button type="button" className={styles.textButton} onClick={onClose}>Cancel</button>
                </div>
            </form>
        </dialog>
    );
}
