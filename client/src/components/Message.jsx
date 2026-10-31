import styles from './Message.module.css';

// type: 'error' | 'success' | 'info'. Renders nothing when there is no text.
export function Message({ type = 'info', children }) {
    if (!children) return null;
    return (
        <p role={type === 'error' ? 'alert' : 'status'} className={`${styles.message} ${styles[type]}`}>
            {children}
        </p>
    );
}
