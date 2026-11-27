import { useEffect, useRef, useState } from 'react';
import { getItemCalendar } from '../api/items.js';
import { useCardTilt } from '../hooks/useCardTilt.js';
import { useAction } from '../hooks/useAction.js';
import { Button } from './Button.jsx';
import { Calendar, toKey } from './Calendar.jsx';
import { Message } from './Message.jsx';
import styles from './ReserveDialog.module.css';

const dayKey = value => { const date = new Date(value); return toKey(new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())); };

// The amber card for changing the dates of something on the borrow list. save({ startDate, endDate }) does the request.
export function DatesDialog({ entry, onSave, onClose }) {
    const dialog = useRef(null);
    useCardTilt(dialog);
    const save = useAction();
    const [booked, setBooked] = useState([]);
    const [range, setRange] = useState({ start: '', end: '' });
    const open = Boolean(entry);

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
        if (!entry) return;
        save.reset();
        setRange({ start: dayKey(entry.startDate), end: dayKey(entry.endDate) });
        getItemCalendar(entry.item._id).then(data => setBooked(data.reservations ?? [])).catch(() => setBooked([]));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [entry]);

    async function handleSubmit(event) {
        event.preventDefault();
        if (await save.run(() => onSave({ startDate: range.start, endDate: range.end }))) onClose();
    }

    return <dialog ref={dialog} className={styles.dialog} aria-label="Change dates" onCancel={event => { event.preventDefault(); onClose(); }} onClose={onClose}>
        {entry && <form onSubmit={handleSubmit}>
            <h2>Change dates for {entry.item.name}</h2>
            <Calendar key={entry.item._id} booked={booked} value={range} onChange={setRange} />
            <Message type="error">{save.error}</Message>
            <Button type="submit" fullWidth pending={save.pending} disabled={!range.start || !range.end}>Save dates</Button>
            <div className={styles.footer}>
                <button type="button" className={styles.textButton} onClick={onClose}>Cancel</button>
            </div>
        </form>}
    </dialog>;
}
