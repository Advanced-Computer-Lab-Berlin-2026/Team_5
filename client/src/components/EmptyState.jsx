import { Icon } from './Icon.jsx';
import styles from './EmptyState.module.css';

export function EmptyState({ title, description, action }) {
    return <div className={styles.empty}>
        <Icon name="box" size={32} />
        <h2>{title}</h2>
        {description && <p>{description}</p>}
        {action}
    </div>;
}
