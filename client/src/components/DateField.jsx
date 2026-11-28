import { useEffect, useRef, useState } from 'react';
import { Calendar } from './Calendar.jsx';
import { Icon } from './Icon.jsx';
import styles from './DateRangeField.module.css';

const show = key => new Date(`${key}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

// One day, picked on our calendar (the single-day sibling of DateRangeField, with the same look).
// value: YYYY-MM-DD or ''. onChange(day) runs when a day is pressed, or with '' when cleared. minDate defaults to today.
export function DateField({ value, onChange, placeholder = 'Pick a day', label = 'Date', minDate, id }) {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef(null);
    useEffect(() => {
        if (!open) return undefined;
        const outside = event => { if (!wrapRef.current?.contains(event.target)) setOpen(false); };
        const key = event => { if (event.key === 'Escape') setOpen(false); };
        document.addEventListener('pointerdown', outside);
        document.addEventListener('keydown', key);
        return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key); };
    }, [open]);

    return <div ref={wrapRef} className={styles.wrap}>
        <button id={id} type="button" className={`${styles.field} ${value ? styles.set : ''}`} aria-label={value ? `${label}: ${show(value)}` : label} aria-expanded={open} onClick={() => setOpen(current => !current)}>
            <Icon name="calendar" size={18} />
            <span className={value ? '' : styles.placeholder}>{value ? show(value) : placeholder}</span>
        </button>
        {value && <button type="button" className={styles.clear} aria-label={`Clear ${label.toLowerCase()}`} onClick={() => onChange('')}><Icon name="close" size={16} /></button>}
        {open && <div className={styles.panel} role="dialog" aria-label={label}>
            <Calendar compact legend={false} value={{ start: value, end: '' }} onChange={next => { if (next.start) { onChange(next.start); setOpen(false); } }} {...(minDate !== undefined ? { minDate: minDate || '0000-01-01' } : {})} />
        </div>}
    </div>;
}
