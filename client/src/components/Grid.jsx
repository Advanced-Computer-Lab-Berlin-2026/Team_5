import styles from './Grid.module.css';

// Responsive grid of equal columns, used for lists of cards.
export function Grid({ children }) {
    return <div className={styles.grid}>{children}</div>;
}

// A horizontal group of controls (buttons, filters) that wraps on small screens.
export function Row({ children }) {
    return <div className={styles.row}>{children}</div>;
}
