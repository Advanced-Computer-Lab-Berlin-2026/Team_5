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
// readOnly: just shows the month (nothing can be picked, past days are not greyed out and you can page back), with the requested dates
// in amber: `value` for one range, or `ranges` ([{ id, start, end }], both days included) for several, where the ones in `activeIds`
// are solid amber and the others are outlined. With `onDayClick(key, rangeIds)`, a day inside a range can be pressed. compact makes the days a little shorter so a whole month fits in a small card.
export function Calendar({ booked = [], value, onChange, minDate = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10), readOnly = false, compact = false, ranges, activeIds, onDayClick, fixedStart, allowBooked = false, legend = true }) {
    const shown = ranges ?? (value?.start ? [{ id: 'value', start: value.start, end: value.end || value.start }] : []);
    const [month, setMonth] = useState(() => {
        const first = shown.find(range => activeIds?.includes(range.id)) ?? shown[0];
        const base = first ? fromKey(first.start) : value?.start ? fromKey(value.start) : new Date();
        return new Date(base.getFullYear(), base.getMonth(), 1);
    });
    const blocked = useMemo(() => {
        const days = new Set();
        for (const range of booked) {
            const last = new Date(range.endDate);
            for (let day = new Date(range.startDate); day < last; day.setUTCDate(day.getUTCDate() + 1)) days.add(toKey(new Date(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate())));
        }
        return days;
    }, [booked]);

    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7; // weeks start on Monday
    const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const cells = [...Array(offset).fill(null), ...Array.from({ length: count }, (_, index) => toKey(new Date(month.getFullYear(), month.getMonth(), index + 1)))];

    // fixedStart: the first day cannot change (asking for more days on a booking), so every press picks the last day
    const selectingFrom = fixedStart || (!value?.end && value?.start);
    const blockedBetween = end => [...blocked].some(day => day >= selectingFrom && day < end);
    function pick(key) {
        if (fixedStart) { if (key > fixedStart) onChange({ start: fixedStart, end: key }); return; }
        if (!value?.start || value.end || key <= value.start) onChange({ start: key, end: '' });
        else onChange({ start: value.start, end: key });
    }
    const shift = amount => setMonth(new Date(month.getFullYear(), month.getMonth() + amount, 1));
    const canGoBack = readOnly || month > new Date(fromKey(minDate).getFullYear(), fromKey(minDate).getMonth(), 1);

    const firstAllowed = readOnly ? '0000-01-01' : minDate;
    return <div className={`${styles.calendar} ${compact ? styles.compact : ''}`}>
        <div className={styles.head}>
            <button type="button" className={styles.nav} onClick={() => shift(-1)} disabled={!canGoBack} aria-label="Previous month"><Icon name="back" size={18} /></button>
            <strong>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</strong>
            <button type="button" className={styles.nav} onClick={() => shift(1)} aria-label="Next month"><Icon name="back" size={18} style={{ transform: 'scaleX(-1)' }} /></button>
        </div>
        <div className={styles.grid} role="grid">
            {DAYS.map(day => <span key={day} className={styles.weekday}>{day}</span>)}
            {cells.map((key, index) => {
                if (!key) return <span key={`gap${index}`} />;
                const selectingEnd = Boolean(selectingFrom && key > selectingFrom);
                const unavailable = key < firstAllowed || (!allowBooked && (selectingEnd
                    ? blockedBetween(key)
                    : blocked.has(key)));
                const start = key === value?.start;
                const end = key === value?.end;
                const inside = value?.start && value?.end && key > value.start && key < value.end;
                if (readOnly) {
                    const hits = shown.filter(range => key >= range.start && key <= range.end);
                    const active = hits.some(range => !activeIds || activeIds.includes(range.id));
                    const requested = hits.length > 0;
                    const classes = `${styles.day} ${styles.still} ${requested ? (active ? styles.requested : styles.requestedOther) : ''} ${blocked.has(key) && !requested ? styles.booked : ''}`;
                    const label = `${fromKey(key).toLocaleDateString(undefined, { dateStyle: 'full' })}${requested ? ', requested' : ''}${blocked.has(key) ? ', booked' : ''}`;
                    return requested && onDayClick
                        ? <button key={key} type="button" className={`${classes} ${styles.pressable}`} aria-label={label} aria-pressed={active} onClick={() => onDayClick(key, hits.map(range => range.id))}>{Number(key.slice(8))}</button>
                        : <span key={key} className={classes} aria-label={label}>{Number(key.slice(8))}</span>;
                }
                return <button key={key} type="button" disabled={unavailable} onClick={() => pick(key)}
                    className={`${styles.day} ${start || end ? styles.edge : ''} ${inside ? styles.inside : ''} ${blocked.has(key) ? styles.booked : ''}`}
                    aria-pressed={start || end || inside || undefined} aria-label={`${fromKey(key).toLocaleDateString(undefined, { dateStyle: 'full' })}${blocked.has(key) ? ', booked' : ''}`}>
                    {Number(key.slice(8))}
                </button>;
            })}
        </div>
        {legend && <p className={styles.legend}><span className={styles.swatchBooked} /> booked <span className={readOnly ? styles.swatchRequested : styles.swatchPicked} /> {readOnly ? 'requested' : 'your dates'}</p>}
    </div>;
}
