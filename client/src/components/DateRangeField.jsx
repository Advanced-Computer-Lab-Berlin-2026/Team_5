import { useEffect, useRef, useState } from 'react';
import { Calendar } from './Calendar.jsx';
import { Icon } from './Icon.jsx';
import styles from './DateRangeField.module.css';

const show = key => new Date(`${key}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

// A date range picker that looks like the Discover search box: press it and our calendar drops down; pick a first and a last day.
// value: { start, end } as YYYY-MM-DD ('' when not set). onChange({ start, end }) runs once both days are picked, or with
// empty values when cleared. minDate: the earliest day that can be picked (defaults to today; pass '' to allow any day).
// compact: just a small calendar-icon button (it shows the chosen days next to the icon once they are set), for a toolbar row.
export function DateRangeField({ value, onChange, placeholder = 'Any dates', label = 'Dates', minDate, className = '', compact = false }) {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState({ start: value?.start ?? '', end: value?.end ?? '' });
    const wrapRef = useRef(null);
    const set = Boolean(value?.start && value?.end);

    useEffect(() => { if (open) setDraft({ start: value?.start ?? '', end: value?.end ?? '' }); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (!open) return undefined;
        const outside = event => { if (!wrapRef.current?.contains(event.target)) setOpen(false); };
        const key = event => { if (event.key === 'Escape') setOpen(false); };
        document.addEventListener('pointerdown', outside);
        document.addEventListener('keydown', key);
        return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key); };
    }, [open]);

    function pick(next) {
        setDraft(next);
        if (next.start && next.end) { onChange(next); setOpen(false); }
    }

    const short = key => new Date(`${key}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    return <div ref={wrapRef} className={`${styles.wrap} ${compact ? styles.compactWrap : ''} ${className}`}>
        {compact
            ? <button type="button" className={`${styles.iconButton} ${set ? styles.set : ''}`} title={set ? `${short(value.start)} – ${short(value.end)}` : label}
                aria-label={set ? `${label}: ${show(value.start)} to ${show(value.end)}` : label} aria-expanded={open} onClick={() => setOpen(current => !current)}>
                <Icon name="calendar" size={18} />
                {set && <span>{short(value.start)} – {short(value.end)}</span>}
            </button>
            : null}
        {compact && set && <button type="button" className={styles.compactClear} aria-label={`Clear ${label.toLowerCase()}`} title="Clear dates" onClick={() => onChange({ start: '', end: '' })}><Icon name="close" size={16} /></button>}
        {compact ? null
            : <button type="button" className={`${styles.field} ${set ? styles.set : ''}`} aria-label={set ? `${label}: ${show(value.start)} to ${show(value.end)}` : label} aria-expanded={open} onClick={() => setOpen(current => !current)}>
            <Icon name="calendar" size={18} />
            <span className={set ? '' : styles.placeholder}>{set ? `${show(value.start)} – ${show(value.end)}` : placeholder}</span>
        </button>}
        {set && !compact && <button type="button" className={styles.clear} aria-label={`Clear ${label.toLowerCase()}`} onClick={() => onChange({ start: '', end: '' })}><Icon name="close" size={16} /></button>}
        {open && <div className={styles.panel} role="dialog" aria-label={label}>
            <Calendar compact legend={false} value={draft} onChange={pick} {...(minDate !== undefined ? { minDate: minDate || '0000-01-01' } : {})} />
            <p className={styles.hint}>{draft.start && !draft.end ? 'Now pick the last day.' : 'Pick the first day.'}</p>
        </div>}
    </div>;
}
