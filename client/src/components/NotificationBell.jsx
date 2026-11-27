import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { listNotifications, markNotificationRead } from '../api/notifications.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { formatDateTime } from '../utils/format.js';
import styles from './NotificationBell.module.css';

const POLL_MS = 60000;

// A bell in the header. The dot shows when any of the latest notifications is unread; the panel lists them and links to a reservation
// when a notification belongs to one. The server has no unread count, so only the most recent page is checked.
export function NotificationBell() {
    const { isAdmin } = useAuth();
    const navigate = useNavigate();
    const [items, setItems] = useState([]);
    const [open, setOpen] = useState(false);
    const wrapRef = useRef(null);

    const load = useCallback(() => listNotifications({ page: 1, limit: 8 }).then(data => setItems(data.notifications ?? [])).catch(() => {}), []);
    useEffect(() => {
        load();
        const timer = window.setInterval(load, POLL_MS);
        return () => window.clearInterval(timer);
    }, [load]);
    useEffect(() => {
        if (!open) return undefined;
        const outside = event => { if (!wrapRef.current?.contains(event.target)) setOpen(false); };
        const key = event => { if (event.key === 'Escape') setOpen(false); };
        document.addEventListener('pointerdown', outside);
        document.addEventListener('keydown', key);
        return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key); };
    }, [open]);

    const unread = items.filter(item => !item.read).length;

    async function openOne(item) {
        setOpen(false);
        if (!item.read) {
            setItems(current => current.map(entry => entry._id === item._id ? { ...entry, read: true } : entry));
            markNotificationRead(item._id).catch(load);
        }
        if (!isAdmin && item.reservation) navigate(`/reservations/${item.reservation}`);
    }

    return <div ref={wrapRef} className={styles.wrap}>
        <button type="button" className={styles.bell} aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} aria-expanded={open} onClick={() => setOpen(value => !value)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
            {unread > 0 && <span className={styles.dot} aria-hidden="true" />}
        </button>
        {open && <div className={styles.panel} role="dialog" aria-label="Notifications">
            {items.length === 0 ? <p className={styles.empty}>Nothing new.</p> : <ul className={styles.list}>
                {items.map(item => <li key={item._id}>
                    <button type="button" className={`${styles.entry} ${item.read ? '' : styles.unread}`} onClick={() => openOne(item)}>
                        <span>{item.message}</span>
                        <small>{formatDateTime(item.createdAt)}</small>
                    </button>
                </li>)}
            </ul>}
            <Link to="/notifications" className={styles.all} onClick={() => setOpen(false)}>See all notifications</Link>
        </div>}
    </div>;
}
