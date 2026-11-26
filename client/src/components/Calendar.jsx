import { useMemo, useState } from 'react';
import { Icon } from './Icon.jsx';
import styles from './Calendar.module.css';

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const pad = number => String(number).padStart(2, '0');
// calendar days are plain YYYY-MM-DD strings, so there are no time zone surprises
export const toKey = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const fromKey = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };

// A month grid for picking a date range. booked: [{ startDate, endDate }] that cannot be picked. value: { start, end } as YYYY-MM-DD.
// Click a first day, then a later day; clicking again starts over.
export function Calendar({ booked = [], value, onChange, minDate = toKey(new Date()) }) {
    const [month, setMonth] = useState(() => { const base = value?.start ? fromKey(value.start) : new Date(); return new Date(base.getFullYear(), base.getMonth(), 1); });
    const blocked = useMemo(() => {
        const days = new Set();
        for (const range of booked) {
            const last = new Date(range.endDate);
            for (let day = new Date(range.startDate); day <= last; day.setDate(day.getDate() + 1)) days.add(toKey(new Date(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate())));
        }
        return days;
    }, [booked]);

    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7; // weeks start on Monday
    const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const cells = [...Array(offset).fill(null), ...Array.from({ length: count }, (_, index) => toKey(new Date(month.getFullYear(), month.getMonth(), index + 1)))];

    function pick(key) {
        if (!value?.start || value.end || key <= value.start) onChange({ start: key, end: '' });
        else onChange({ start: value.start, end: key });
    }
    const shift = amount => setMonth(new Date(month.getFullYear(), month.getMonth() + amount, 1));
    const canGoBack = month > new Date(fromKey(minDate).getFullYear(), fromKey(minDate).getMonth(), 1);

    return <div className={styles.calendar}>
        <div className={styles.head}>
            <button type="button" className={styles.nav} onClick={() => shift(-1)} disabled={!canGoBack} aria-label="Previous month"><Icon name="back" size={18} /></button>
            <strong>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</strong>
            <button type="button" className={styles.nav} onClick={() => shift(1)} aria-label="Next month"><Icon name="back" size={18} style={{ transform: 'scaleX(-1)' }} /></button>
        </div>
        <div className={styles.grid} role="grid">
            {DAYS.map(day => <span key={day} className={styles.weekday}>{day}</span>)}
            {cells.map((key, index) => {
                if (!key) return <span key={`gap${index}`} />;
                const unavailable = key < minDate || blocked.has(key);
                const start = key === value?.start;
                const end = key === value?.end;
                const inside = value?.start && value?.end && key > value.start && key < value.end;
                return <button key={key} type="button" disabled={unavailable} onClick={() => pick(key)}
                    className={`${styles.day} ${start || end ? styles.edge : ''} ${inside ? styles.inside : ''} ${blocked.has(key) ? styles.booked : ''}`}
                    aria-pressed={start || end || inside || undefined} aria-label={`${fromKey(key).toLocaleDateString(undefined, { dateStyle: 'full' })}${blocked.has(key) ? ', booked' : ''}`}>
                    {Number(key.slice(8))}
                </button>;
            })}
        </div>
        <p className={styles.legend}><span className={styles.swatchBooked} /> booked <span className={styles.swatchPicked} /> your dates</p>
    </div>;
}
