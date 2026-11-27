import { useState } from 'react';
import styles from './StarRating.module.css';

// Five sharp amber stars. Controlled: value is 0 to 5, onChange(next). Pass readOnly to just show a rating.
export function StarRating({ value = 0, onChange, readOnly = false, label = 'Rating' }) {
    const [hover, setHover] = useState(0);
    const shown = hover || value;
    return <div className={styles.stars} role={readOnly ? 'img' : 'radiogroup'} aria-label={readOnly ? `${label}: ${value} out of 5` : label} onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map(star => readOnly
            ? <span key={star} className={`${styles.star} ${star <= value ? styles.on : ''}`} aria-hidden="true">★</span>
            : <button key={star} type="button" role="radio" aria-checked={value === star} aria-label={`${star} out of 5`} className={`${styles.star} ${star <= shown ? styles.on : ''}`}
                onMouseEnter={() => setHover(star)} onClick={() => onChange?.(star)}>★</button>)}
    </div>;
}
