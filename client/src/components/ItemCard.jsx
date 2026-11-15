import { Link } from 'react-router-dom';
import { Button } from './Button.jsx';
import { Icon } from './Icon.jsx';
import { ItemImage } from './ItemImage.jsx';
import styles from './ItemCard.module.css';

export function ItemCard({ item, actions }) {
    const to = `/items/${encodeURIComponent(item._id)}`;
    return <article className={styles.card}>
        <Link to={to} className={styles.imageLink} aria-label={`View ${item.name}`} tabIndex={-1}>
            <ItemImage src={item.photos?.[0]?.url} alt={item.name} className={styles.image} />
        </Link>
        <div className={styles.body}>
            <p className={styles.category}>{item.category}</p>
            <h2><Link to={to}>{item.name}</Link></h2>
            <p className={styles.deposit}>Deposit <strong>{item.depositAmount} ₥</strong></p>
            <div className={styles.actions}>
                <Button variant="secondary" size="small" to={to}>View item <Icon name="arrow" size={16} /></Button>
                {actions}
            </div>
        </div>
    </article>;
}
