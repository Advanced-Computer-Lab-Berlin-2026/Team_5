import styles from './Table.module.css';

// columns: [{ key, header, render? }]. render(row) overrides showing row[key].
export function Table({ columns, rows, getRowKey, empty = 'Nothing to show.' }) {
    if (rows.length === 0) return <p className={styles.empty}>{empty}</p>;
    return (
        <div className={styles.wrapper}>
            <table className={styles.table}>
                <thead>
                    <tr>
                        {columns.map((column) => (
                            <th key={column.key}>{column.header}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row) => (
                        <tr key={getRowKey(row)}>
                            {columns.map((column) => (
                                <td key={column.key}>{column.render ? column.render(row) : row[column.key]}</td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
