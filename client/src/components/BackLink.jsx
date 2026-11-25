import { Link, useNavigate } from 'react-router-dom';
import { Icon } from './Icon.jsx';
import styles from './BackLink.module.css';

// The < arrow used for every "back to ..." link. The label is for screen readers and the hover tooltip.
// With history, it steps back to the page you were just on (keeping its scroll position) instead of opening `to` fresh.
export function BackLink({ to, label, size = 32, history = false }) {
    const navigate = useNavigate();
    return <Link to={to} className={styles.back} aria-label={label} title={label}
        onClick={history ? event => { event.preventDefault(); navigate(-1); } : undefined}><Icon name="back" size={size} /></Link>;
}
