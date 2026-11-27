import { useState } from 'react';
import { exportDamageReport, exportUsageReport, getDamageReport, getReferralReport, getTierDistribution, getUsageReport } from '../api/reports.js';
import { useAction } from '../hooks/useAction.js';
import { useAsync } from '../hooks/useAsync.js';
import { Button, Card, FormField, Message, PageHeader, Row, Select, Spinner, Table } from '../components';
import { formatDate } from '../utils/format.js';
import styles from './AdminReportsPage.module.css';

const STATUSES = [['', 'All cases'], ['pending-review', 'Pending review'], ['disputed', 'Disputed'], ['resolved', 'Resolved'], ['decided', 'Decided']].map(([value, label]) => ({ value, label }));
const thisMonth = () => new Date().toISOString().slice(0, 7);
// the last 12 months, newest first, for the month picker
const MONTHS = Array.from({ length: 12 }, (_, index) => { const date = new Date(); date.setMonth(date.getMonth() - index); const value = date.toISOString().slice(0, 7); return { value, label: date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) }; });

function Bars({ tiers }) {
    const max = Math.max(1, ...tiers.map(tier => tier.members));
    return <ul className={styles.bars}>
        {tiers.map(tier => <li key={tier.tier}>
            <span className={styles.barLabel}>{tier.tier}</span>
            <span className={styles.track}><span className={styles.fill} style={{ width: `${(tier.members / max) * 100}%` }} /></span>
            <span className={styles.barValue}>{tier.members} · {tier.percentage}%</span>
        </li>)}
    </ul>;
}

function ExportButtons({ onExport, pending }) {
    return <Row>
        <Button variant="secondary" size="small" disabled={pending} onClick={() => onExport('csv')}>Export CSV</Button>
        <Button variant="secondary" size="small" disabled={pending} onClick={() => onExport('pdf')}>Export PDF</Button>
    </Row>;
}

export default function AdminReportsPage() {
    const [month, setMonth] = useState(thisMonth());
    const [status, setStatus] = useState('');
    const [item, setItem] = useState('');
    const [category, setCategory] = useState('');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const usageFilters = { ...(from && to ? { from, to } : { month }), item, category };
    const tiers = useAsync(getTierDistribution);
    const referrals = useAsync(getReferralReport);
    const usage = useAsync(() => getUsageReport(usageFilters), [month, from, to, item, category]);
    const damage = useAsync(() => getDamageReport(status), [status]);
    const exporting = useAction();

    return <>
        <PageHeader title="Reports" />
        <Message type="error">{exporting.error}</Message>

        <Card title="Membership tiers">
            {tiers.loading && <Spinner />}
            <Message type="error">{tiers.error}</Message>
            {tiers.data && <><p className={styles.muted}>{tiers.data.totalMembers} members in total</p><Bars tiers={tiers.data.tiers} /></>}
        </Card>

        <Card title="Referrals">
            <Message type="error">{referrals.error}</Message>
            {referrals.data && <div className={styles.tiles}>
                <div><strong>{referrals.data.summary.referralsSent}</strong><span>codes used to join</span></div>
                <div><strong>{referrals.data.summary.referralsConverted}</strong><span>finished a first borrow</span></div>
                <div><strong>{referrals.data.summary.creditsIssued} ₥</strong><span>credit paid to inviters</span></div>
            </div>}
        </Card>

        <Card title="Item usage" footer={<ExportButtons pending={exporting.pending} onExport={format => exporting.run(() => exportUsageReport(format, usageFilters))} />}>
            <div className={styles.filter}><Select name="month" aria-label="Month" value={month} options={MONTHS} onChange={event => setMonth(event.target.value)} /></div>
            <FormField label="Item ID" name="usageItem" value={item} onChange={event => setItem(event.target.value)} />
            <FormField label="Category" name="usageCategory" value={category} onChange={event => setCategory(event.target.value)} />
            <Row>
                <FormField label="From" name="usageFrom" type="date" value={from} onChange={event => { setFrom(event.target.value); setTo(''); }} />
                <FormField label="To" name="usageTo" type="date" value={to} min={from || undefined} disabled={!from} onChange={event => setTo(event.target.value)} />
            </Row>
            {usage.loading && !usage.data && <Spinner />}
            <Message type="error">{usage.error}</Message>
            {usage.data && <>
                <p className={styles.muted}>{usage.data.report.totals.reservations} reservations across {usage.data.report.totals.items} items in {usage.data.report.period.label}</p>
                <h3>By category</h3>
                <Table rows={usage.data.report.categories} getRowKey={row => row.category} empty="No category usage in this period."
                    columns={[
                        { key: 'category', header: 'Category' },
                        { key: 'items', header: 'Items' },
                        { key: 'reservations', header: 'Reservations' },
                        { key: 'daysReserved', header: 'Days reserved' },
                        { key: 'deposits', header: 'Deposits', render: row => `${row.deposits} ₥` }
                    ]} />
                <h3>By item</h3>
                <Table rows={usage.data.report.items} getRowKey={row => row.itemId} empty="No reservations in this period."
                    columns={[
                        { key: 'name', header: 'Item' },
                        { key: 'category', header: 'Category' },
                        { key: 'reservations', header: 'Reservations' },
                        { key: 'daysReserved', header: 'Days' },
                        { key: 'deposits', header: 'Deposits', render: row => `${row.deposits} ₥` }
                    ]} />
            </>}
        </Card>

        <Card title="Damage reports" footer={<ExportButtons pending={exporting.pending} onExport={format => exporting.run(() => exportDamageReport(format, status))} />}>
            <div className={styles.filter}><Select name="status" aria-label="Status" value={status} options={STATUSES} onChange={event => setStatus(event.target.value)} /></div>
            {damage.loading && !damage.data && <Spinner />}
            <Message type="error">{damage.error}</Message>
            {damage.data && <Table rows={damage.data.report.cases} getRowKey={row => row.reservation} empty="No damage cases."
                columns={[
                    { key: 'item', header: 'Item', render: row => row.item?.name ?? '-' },
                    { key: 'borrower', header: 'Borrower' },
                    { key: 'lender', header: 'Lender' },
                    { key: 'status', header: 'Status' },
                    { key: 'depositAmount', header: 'Deposit', render: row => (row.depositAmount == null ? '-' : `${row.depositAmount} ₥`) },
                    { key: 'openedAt', header: 'Opened', render: row => formatDate(row.openedAt) },
                    { key: 'open', header: '', render: row => row.id ? <Button variant="secondary" size="small" to={`/admin/damage/${row.id}`}>Open</Button> : null }
                ]} />}
        </Card>
    </>;
}
