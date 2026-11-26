import { Icon } from './Icon.jsx';
import styles from './FilterBar.module.css';

// Button that shows or hides the category row.
export function FilterToggle({ open, activeCount = 0, onToggle, controls }) {
    return <button type="button" className={styles.trigger} aria-expanded={open} aria-controls={controls} onClick={onToggle}>
        Filters{activeCount > 0 && <span className={styles.badge}>{activeCount}</span>} <Icon name="down" size={16} />
    </button>;
}

// Extra row of category chips under the search bar. Always mounted so it can animate open and closed.
export function CategoryRow({ id, open, value, options, onChange, loading = false }) {
    return <div id={id} className={styles.wrap} data-open={open ? '' : undefined}>
        <div className={styles.inner} inert={!open}>
            <div className={styles.row} role="group" aria-label="Filter by category" aria-busy={loading}>
                {options.map(option => <button key={option.value} type="button" className={`${styles.chip} ${option.value === value ? styles.active : ''}`} aria-pressed={option.value === value} disabled={loading} onClick={() => onChange(option.value)}>{option.label}</button>)}
            </div>
        </div>
    </div>;
}
