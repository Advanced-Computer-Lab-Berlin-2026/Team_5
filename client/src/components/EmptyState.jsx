import { Icon } from './Icon.jsx';
import TiltedCard from './TiltedCard.jsx';
import styles from './EmptyState.module.css';

// featured: a larger, inviting version with a floating icon, for places where there is a clear next step (a call to action)
export function EmptyState({ title, description, action, icon = 'box', featured = false }) {
    const content = <div className={`${styles.empty} ${featured ? styles.featured : ''}`}>
        {featured ? <span className={styles.badge}><Icon name={icon} size={36} /></span> : <Icon name={icon} size={32} />}
        <h2>{title}</h2>
        {description && <p>{description}</p>}
        {action}
    </div>;
    // the featured card tilts toward the pointer with a glare, like the item cards
    if (!featured) return content;
    return <TiltedCard containerWidth="100%" containerHeight="var(--empty-card-height)" imageWidth="100%" imageHeight="100%" className={styles.tilt} radius={12}
        rotateAmplitude={4} scaleOnHover={1.01} glare={0.18} shadow={0.35} parallax={0} showTooltip={false} intro={false} altText={title}>
        {content}
    </TiltedCard>;
}
