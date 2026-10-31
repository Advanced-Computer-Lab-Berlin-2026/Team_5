import styles from './DetailList.module.css';

// Label and value pairs. rows: [[label, value]]. Rows with an empty value are skipped.
export function DetailList({ rows }) {
    const shown = rows.filter(([, value]) => value !== undefined && value !== null && value !== '');
    return (
        <dl className={styles.list}>
            {shown.map(([label, value]) => (
                <div key={label} className={styles.row}>
                    <dt className={styles.label}>{label}</dt>
                    <dd className={styles.value}>{value}</dd>
                </div>
            ))}
        </dl>
    );
}
