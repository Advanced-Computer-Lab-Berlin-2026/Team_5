import { useState } from 'react';
import { Link } from 'react-router-dom';
import { listNotifications, markNotificationRead } from '../api/notifications.js';
import { useAsync } from '../hooks/useAsync.js';
import { Button, EmptyState, Message, PageHeader, Pagination, Spinner } from '../components';
import ScrollStack, { ScrollStackItem } from '../components/ScrollStack.jsx';
import { formatDateTime } from '../utils/format.js';
import styles from './NotificationsPage.module.css';

const PAGE_SIZE = 10;

export default function NotificationsPage() {
    const [page, setPage] = useState(1);
    const { data, error, loading, reload } = useAsync(() => listNotifications({ page, limit: PAGE_SIZE }), [page]);
    const [read, setRead] = useState(() => new Set());

    async function markRead(id) {
        setRead(current => new Set(current).add(id));
        try { await markNotificationRead(id); } catch { reload(); }
    }

    return <>
        <PageHeader title="Notifications" />
        {loading && !data && <Spinner />}
        <Message type="error">{error}</Message>
        {data?.notifications.length === 0 && <EmptyState title="All caught up" description="Updates about your reservations and the community show up here." />}
        {data?.notifications.length > 0 && <>
            <ScrollStack key={page} useWindowScroll smoothScroll={false} className={styles.stack} stackPosition={128} itemDistance={20}
                itemStackDistance={16} itemScale={0.04} baseScale={0.85} dimAmount={0.15} holdDistance={100}>
                {data.notifications.map(notification => {
                    const isRead = notification.read || read.has(notification._id);
                    return <ScrollStackItem key={notification._id} itemClassName={`${styles.note} ${isRead ? '' : styles.unread}`}>
                        <p className={styles.message}>{notification.message}</p>
                        <div className={styles.foot}>
                            <small>{formatDateTime(notification.createdAt)}</small>
                            <span className={styles.actions}>
                                {notification.reservation && <Link to={`/reservations/${notification.reservation}`}>Open reservation</Link>}
                                {!isRead && <Button variant="secondary" size="small" onClick={() => markRead(notification._id)}>Mark as read</Button>}
                            </span>
                        </div>
                    </ScrollStackItem>;
                })}
            </ScrollStack>
            <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} onChange={setPage} />
        </>}
    </>;
}
