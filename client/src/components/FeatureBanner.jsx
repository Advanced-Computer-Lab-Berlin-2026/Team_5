import { Icon } from './Icon.jsx';
import styles from './FeatureBanner.module.css';

export function FeatureBanner({ eyebrow = 'Shared possibilities', title, description, action }) {
    return <section className={styles.banner} data-theme="dark">
        <div className={styles.copy}>
            <p className="eyebrow">{eyebrow}</p>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
            {action}
        </div>
        <div className={styles.mark} aria-hidden="true"><Icon name="box" size={110} /></div>
    </section>;
}
