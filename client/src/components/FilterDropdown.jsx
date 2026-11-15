import { useEffect, useRef } from 'react';
import { Icon } from './Icon.jsx';
import { Select } from './Select.jsx';
import styles from './FilterDropdown.module.css';

export function FilterDropdown({ value, options, onChange, loading = false }) {
    const root = useRef(null);
    const trigger = useRef(null);
    useEffect(() => {
        const outside = event => { if (!root.current?.contains(event.target) && root.current) root.current.open = false; };
        const escape = event => {
            if (event.key === 'Escape' && root.current?.open) { root.current.open = false; trigger.current?.focus(); }
        };
        document.addEventListener('pointerdown', outside);
        document.addEventListener('keydown', escape);
        return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
    }, []);
    return <details ref={root} className={styles.dropdown} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }}>
        <summary ref={trigger} className={styles.trigger}>Filters{value && <span className={styles.badge}>1</span>} <Icon name="down" size={16} /></summary>
        <div className={styles.panel}>
            <label htmlFor="catalog-category">Category</label>
            <Select id="catalog-category" name="category" value={value} disabled={loading} options={options} onChange={event => { onChange(event.target.value); root.current.open = false; trigger.current?.focus(); }} />
        </div>
    </details>;
}
