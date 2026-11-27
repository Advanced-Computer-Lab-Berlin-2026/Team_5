import { Fragment } from 'react';
import styles from './Table.module.css';

// columns: [{ key, header, render? }]. render(row) overrides showing row[key].
// expandedKey + renderExpanded(row): the row with that key gets a full-width panel that opens underneath it.
export function Table({ columns, rows, getRowKey, empty = 'Nothing to show.', expandedKey, renderExpanded }) {
    if (rows.length === 0) return <p className={styles.empty}>{empty}</p>;
    return (
        <div className={styles.wrapper} role="region" aria-label="Scrollable data table" tabIndex={0}>
            <table className={styles.table}>
                <thead>
                    <tr>
                        {columns.map((column) => (
                            <th key={column.key} scope="col">{column.header || <span className="sr-only">Actions</span>}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row) => {
                        const key = getRowKey(row);
                        const expanded = renderExpanded && expandedKey === key;
                        return <Fragment key={key}>
                            <tr className={expanded ? styles.openRow : undefined}>
                                {columns.map((column) => (
                                    <td key={column.key}>{column.render ? column.render(row) : row[column.key]}</td>
                                ))}
                            </tr>
                            {expanded && <tr className={styles.expandedRow}>
                                <td colSpan={columns.length}><div className={styles.expanded}>{renderExpanded(row)}</div></td>
                            </tr>}
                        </Fragment>;
                    })}
                </tbody>
            </table>
        </div>
    );
}
