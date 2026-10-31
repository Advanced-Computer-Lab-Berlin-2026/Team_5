import styles from './Card.module.css';

export function Card({ title, children, footer }) {
    return (
        <section className={styles.card}>
            {title && <h2 className={styles.title}>{title}</h2>}
            <div>{children}</div>
            {footer && <div className={styles.footer}>{footer}</div>}
        </section>
    );
}
