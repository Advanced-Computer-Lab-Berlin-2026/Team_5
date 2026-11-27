import { useState } from 'react';
import { Link } from 'react-router-dom';
import { decideUserReport, listUserReports } from '../api/reports.js';
import { useAction } from '../hooks/useAction.js';
import { useAsync } from '../hooks/useAsync.js';
import { Button, ConfirmDialog, EmptyState, Message, PageHeader, Select, Spinner } from '../components';
import { formatDateTime } from '../utils/format.js';
import styles from './AdminModerationPage.module.css';

const STATUSES = [['open', 'Waiting for a decision'], ['flagged', 'Flagged'], ['removed', 'Removed'], ['dismissed', 'Dismissed'], ['all', 'All']].map(([value, label]) => ({ value, label }));

// what each decision does, said plainly before it happens
const EFFECT = {
    item: { flag: 'The item is hidden from the catalog.', remove: 'The item is hidden and archived.', dismiss: 'Nothing changes; the report is closed.' },
    user: { flag: 'The account is suspended and logged out everywhere.', remove: 'The account is DELETED. This cannot be undone.', dismiss: 'Nothing changes; the report is closed.' }
};

// Admin: reports members sent about items and people, oldest first, with flag / remove / dismiss.
export default function AdminModerationPage() {
    const [status, setStatus] = useState('open');
    const { data, error, loading, reload } = useAsync(() => listUserReports(status), [status]);
    const decide = useAction();
    const [pending, setPending] = useState(null); // { report, action }
    const reports = data?.reports ?? [];

    async function handleConfirm() {
        const { report, action } = pending;
        if (await decide.run(() => decideUserReport(report._id, action), `Report ${action === 'dismiss' ? 'dismissed' : action === 'flag' ? 'flagged' : 'acted on'}.`)) { setPending(null); reload(); }
    }

    return <>
        <PageHeader title="Mods" />
        <div className={styles.filter}><Select name="status" aria-label="Show" value={status} options={STATUSES} onChange={event => setStatus(event.target.value)} /></div>
        {loading && !data && <Spinner />}
        <Message type="error">{error}</Message>
        <Message type="success">{decide.success}</Message>
        {data && reports.length === 0 && <EmptyState icon="box" title="Nothing here" description={status === 'open' ? 'No reports are waiting for a decision.' : 'No reports with this status.'} />}
        <div className={styles.list}>
            {reports.map(report => {
                const isItem = report.targetType === 'item';
                const target = isItem ? report.targetItem : report.targetUser;
                return <article key={report._id} className={`${styles.card} ${report.status === 'open' ? styles.open : ''}`}>
                    <div className={styles.head}>
                        <span className={styles.kind}>{isItem ? 'Item' : 'Person'}</span>
                        <h2>{isItem
                            ? (target ? <Link to={`/items/${target._id}`}>{target.name}</Link> : 'Item no longer exists')
                            : (target ? `${target.profile?.name ?? target.username} (@${target.username}, ${target.role})` : 'Account no longer exists')}</h2>
                        <span className={styles.status}>{report.status}</span>
                    </div>
                    <p className={styles.reason}>“{report.reason}”</p>
                    <p className={styles.meta}>Reported by {report.reporter?.profile?.name ?? report.reporter?.username ?? report.reporter} on {formatDateTime(report.createdAt)}
                        {target?.suspended ? ' · already suspended' : ''}{target?.flagged ? ' · already hidden' : ''}{report.reviewedBy ? ` · decided by ${report.reviewedBy}` : ''}</p>
                    {report.status === 'open' && target && <div className={styles.actions}>
                        <Button variant="secondary" size="small" onClick={() => { decide.reset(); setPending({ report, action: 'dismiss' }); }}>Dismiss</Button>
                        <Button size="small" onClick={() => { decide.reset(); setPending({ report, action: 'flag' }); }}>{isItem ? 'Hide item' : 'Suspend'}</Button>
                        <Button variant="destructive" size="small" onClick={() => { decide.reset(); setPending({ report, action: 'remove' }); }}>{isItem ? 'Remove item' : 'Delete account'}</Button>
                    </div>}
                </article>;
            })}
        </div>
        <ConfirmDialog open={Boolean(pending)} tone={pending?.action === 'remove' ? 'danger' : 'dark'} pending={decide.pending} error={decide.error}
            title={pending ? `${pending.action === 'dismiss' ? 'Dismiss' : pending.action === 'flag' ? (pending.report.targetType === 'item' ? 'Hide' : 'Suspend') : (pending.report.targetType === 'item' ? 'Remove' : 'Delete')} — are you sure?` : ''}
            confirmLabel="Yes, do it" cancelLabel="Not now" onConfirm={handleConfirm} onClose={() => setPending(null)}>
            {pending && EFFECT[pending.report.targetType][pending.action]}
        </ConfirmDialog>
    </>;
}
