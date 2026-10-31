import { Button } from './Button.jsx';
import styles from './Pagination.module.css';

export function Pagination({ page, totalPages, onChange }) {
    if (totalPages <= 1) return null;
    return (
        <nav className={styles.pagination} aria-label="Pagination">
            <Button variant="secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}>
                Previous
            </Button>
            <span>
                Page {page} of {totalPages}
            </span>
            <Button variant="secondary" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
                Next
            </Button>
        </nav>
    );
}
