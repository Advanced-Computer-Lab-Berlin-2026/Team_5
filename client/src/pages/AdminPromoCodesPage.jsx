import { useState } from 'react';
import { createPromoCode, getPromoUsage, listPromoCodes } from '../api/adminPromo.js';
import { useAction } from '../hooks/useAction.js';
import { useAsync } from '../hooks/useAsync.js';
import { Button, Card, FormField, Message, PageHeader, Spinner, Table } from '../components';
import { formatDate, formatDateTime } from '../utils/format.js';
import styles from './AdminPromoCodesPage.module.css';

const STATUS_TEXT = { active: 'Active', inactive: 'Off', expired: 'Expired', 'usage-limit-reached': 'Used up' };
const money = value => `${Number(Number(value ?? 0).toFixed(2))} ₥`;

// Admin: make promo codes, see which ones exist and how much they have been used.
export default function AdminPromoCodesPage() {
    const codes = useAsync(listPromoCodes);
    const create = useAction();
    const [form, setForm] = useState({ code: '', discountPercent: '', expiresAt: '', maxUses: '', minimumDeposit: '' });
    const [range, setRange] = useState({ from: '', to: '' });
    const usage = useAsync(() => getPromoUsage({ from: range.from || undefined, to: range.to || undefined }), [range.from, range.to]);
    const set = key => event => setForm(current => ({ ...current, [key]: event.target.value }));

    async function handleCreate(event) {
        event.preventDefault();
        const fields = { code: form.code.trim().toUpperCase(), discountPercent: Number(form.discountPercent) };
        if (form.expiresAt) fields.expiresAt = new Date(`${form.expiresAt}T23:59:59`).toISOString();
        if (form.maxUses) fields.maxUses = Number(form.maxUses);
        if (form.minimumDeposit) fields.minimumDeposit = Number(form.minimumDeposit);
        if (await create.run(() => createPromoCode(fields), `Code ${fields.code} created.`)) {
            setForm({ code: '', discountPercent: '', expiresAt: '', maxUses: '', minimumDeposit: '' });
            codes.reload();
        }
    }

    return <>
        <PageHeader title="Promo codes" />
        <Card title="New code" className={styles.form}>
            <form className={styles.wide} onSubmit={handleCreate}>
                <div className={styles.fields}>
                    <FormField label="Code" name="code" value={form.code} required minLength={3} maxLength={32} pattern="[A-Za-z0-9_-]+" hint="Letters, numbers, - and _" onChange={set('code')} />
                    <FormField label="Discount (%)" name="discountPercent" type="number" min="1" max="100" value={form.discountPercent} required onChange={set('discountPercent')} />
                    <FormField label="Last day (optional)" name="expiresAt" type="date" value={form.expiresAt} onChange={set('expiresAt')} />
                    <FormField label="Max uses (optional)" name="maxUses" type="number" min="1" value={form.maxUses} onChange={set('maxUses')} />
                    <FormField label="Minimum deposit (optional)" name="minimumDeposit" type="number" min="0" step="0.01" value={form.minimumDeposit} onChange={set('minimumDeposit')} />
                </div>
                <Message type="error">{create.error}</Message>
                <Message type="success">{create.success}</Message>
                <Button type="submit" pending={create.pending} disabled={form.code.trim().length < 3 || !form.discountPercent}>Create code</Button>
            </form>
        </Card>

        <Card title="All codes">
            {codes.loading && !codes.data && <Spinner />}
            <Message type="error">{codes.error}</Message>
            {codes.data && <Table rows={codes.data.promoCodes} getRowKey={row => row.code} empty="No promo codes yet."
                columns={[
                    { key: 'code', header: 'Code', render: row => <strong>{row.code}</strong> },
                    { key: 'discountPercent', header: 'Discount', render: row => `${row.discountPercent}%` },
                    { key: 'minimumDeposit', header: 'Min. deposit', render: row => (row.minimumDeposit ? money(row.minimumDeposit) : '–') },
                    { key: 'expiresAt', header: 'Last day', render: row => (row.expiresAt ? formatDate(row.expiresAt) : 'No end') },
                    { key: 'uses', header: 'Used', render: row => `${row.redemptionCount}${row.maxUses ? ` of ${row.maxUses}` : ''}` },
                    { key: 'status', header: 'Status', render: row => <span className={`${styles.status} ${row.status === 'active' ? styles.active : ''}`}>{STATUS_TEXT[row.status] ?? row.status}</span> }
                ]} />}
        </Card>

        <Card title="Usage">
            <div className={styles.range}>
                <FormField label="From" name="usageFrom" type="date" value={range.from} onChange={event => setRange(current => ({ ...current, from: event.target.value }))} />
                <FormField label="To" name="usageTo" type="date" value={range.to} onChange={event => setRange(current => ({ ...current, to: event.target.value }))} />
            </div>
            {usage.loading && !usage.data && <Spinner />}
            <Message type="error">{usage.error}</Message>
            {usage.data && <>
                <div className={styles.totals}>
                    <div><strong>{usage.data.totalRedemptions}</strong><span>times used</span></div>
                    <div><strong>{money(usage.data.totalDiscountIssued)}</strong><span>given as discount</span></div>
                </div>
                <Table rows={usage.data.summary} getRowKey={row => row.code} empty="No codes were used in this period."
                    columns={[
                        { key: 'code', header: 'Code' },
                        { key: 'redemptions', header: 'Times used' },
                        { key: 'discountIssued', header: 'Discount given', render: row => money(row.discountIssued) }
                    ]} />
                {usage.data.redemptions.length > 0 && <details className={styles.details}>
                    <summary>Every use ({usage.data.redemptions.length})</summary>
                    <Table rows={usage.data.redemptions} getRowKey={row => row._id} columns={[
                        { key: 'date', header: 'When', render: row => formatDateTime(row.date ?? row.createdAt) },
                        { key: 'code', header: 'Code', render: row => row.code?.code ?? row.code },
                        { key: 'user', header: 'Member', render: row => row.user?.profile?.name ?? row.user?.username ?? row.user },
                        { key: 'discountAmount', header: 'Discount', render: row => money(row.discountAmount) }
                    ]} />
                </details>}
            </>}
        </Card>
    </>;
}
