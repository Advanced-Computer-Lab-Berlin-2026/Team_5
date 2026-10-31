import styles from './Input.module.css';

export function TextArea({ className = '', rows = 4, ...props }) {
    return <textarea rows={rows} className={`${styles.input} ${styles.textarea} ${className}`} {...props} />;
}
