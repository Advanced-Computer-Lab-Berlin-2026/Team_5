import styles from './Card.module.css';

// actions: something to show on the right of the title (a filter button, for example)
export function Card({ title, actions, children, footer, className = '', ...props }) {
    return (
        <section className={`${styles.card} ${className}`} {...props}>
            {title && (actions
                ? <div className={styles.head}><h2 className={styles.title}>{title}</h2>{actions}</div>
                : <h2 className={styles.title}>{title}</h2>)}
            <div>{children}</div>
            {footer && <div className={styles.footer}>{footer}</div>}
        </section>
    );
}
