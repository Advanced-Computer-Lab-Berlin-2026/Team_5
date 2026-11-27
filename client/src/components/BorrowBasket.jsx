import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { getBorrowList } from '../api/borrowList.js';
import styles from './BorrowBasket.module.css';

// fired by anything that changes the borrow list, so the basket count updates straight away
export const BORROW_LIST_CHANGED = 'acl:borrow-list-changed';
export const announceBorrowListChange = () => window.dispatchEvent(new Event(BORROW_LIST_CHANGED));

// A basket in the header, next to the bell: opens the borrow list (checkout), with the number of items waiting to be paid for.
export function BorrowBasket() {
    const location = useLocation();
    const [count, setCount] = useState(0);
    const load = useCallback(() => getBorrowList().then(data => setCount(data.borrowList?.length ?? 0)).catch(() => {}), []);
    // the count is checked again on every page change and whenever the list changes
    useEffect(() => { load(); }, [load, location.pathname]);
    useEffect(() => {
        window.addEventListener(BORROW_LIST_CHANGED, load);
        return () => window.removeEventListener(BORROW_LIST_CHANGED, load);
    }, [load]);

    return <Link to="/borrow-list" className={styles.basket} aria-label={count ? `Borrow list, ${count} ${count === 1 ? 'item' : 'items'}` : 'Borrow list'}>
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m5 11 4-7M19 11l-4-7M2 11h20M3.5 11l1.6 7.4a2 2 0 0 0 2 1.6h9.8a2 2 0 0 0 2-1.6l1.6-7.4M9 15v2M15 15v2M12 15v2" />
        </svg>
        {count > 0 && <span key={count} className={styles.count}>{count}</span>}
    </Link>;
}
