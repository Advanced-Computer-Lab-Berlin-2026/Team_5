import styles from './PageHeader.module.css';

export function PageHeader({ eyebrow, title, description, actions }) {
    return <header className={styles.header}>
        <div className={styles.copy}>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            <h1>{title}</h1>
            {description && <p className="muted">{description}</p>}
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
    </header>;
}
