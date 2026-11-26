import styles from './Spinner.module.css';

export function Spinner({ label = 'Loading...' }) {
    return (
        <p role="status" className={styles.spinner}>
            <span className={styles.indicator} aria-hidden="true" />
            {label}
        </p>
    );
}
