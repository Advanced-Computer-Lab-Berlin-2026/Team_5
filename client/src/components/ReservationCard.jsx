import { Link } from 'react-router-dom';
import { formatDate } from '../utils/format.js';
import { ItemImage } from './ItemImage.jsx';
import styles from './ReservationCard.module.css';

export const STATUS_LABELS = { pending: 'Waiting for the owner', upcoming: 'Approved', active: 'In progress', completed: 'Completed', cancelled: 'Cancelled', rejected: 'Declined', expired: 'No reply' };

// A small sharp chip for a reservation's status
export function StatusChip({ status }) {
    return <span className={`${styles.chip} ${styles[status] ?? ''}`}>{STATUS_LABELS[status] ?? status}</span>;
}

// One reservation as a row: photo, item, dates and status, with the page's own buttons (`children`) on the right.
// `who` is the other person ("Lent by x" / "Requested by x"); `to` makes the title a link.
export function ReservationCard({ reservation, who, to, hideStatus = false, children }) {
    const item = reservation.item ?? {};
    const title = item.name ?? 'Item no longer listed';
    return <article className={styles.card}>
        <ItemImage src={item.photos?.[0]?.url} alt={title} className={styles.photo} />
        <div className={styles.body}>
            <h2 className={styles.title}>{to ? <Link to={to}>{title}</Link> : title}</h2>
            <p className={styles.meta}>{formatDate(reservation.startDate)} to {formatDate(reservation.endDate)}{who ? ` · ${who}` : ''}</p>
            {!hideStatus && <StatusChip status={reservation.status} />}
        </div>
        {children && <div className={styles.actions}>{children}</div>}
    </article>;
}
