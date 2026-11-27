import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { damageCasePdfUrl, decideDamageCase, getDamageCase, resolveDamageCase } from '../api/damageReports.js';
import { useAction } from '../hooks/useAction.js';
import { useAsync } from '../hooks/useAsync.js';
import { Button, Card, DetailList, FormField, Message, PageHeader, Spinner } from '../components';
import { formatDateTime } from '../utils/format.js';
import styles from './AdminDamageCasePage.module.css';

const STEP_LABELS = { report: 'Lender reported damage', decision: 'Admin decided', dispute: 'Borrower disputed', resolution: 'Final ruling' };

function Photos({ title, photos }) {
    if (!photos?.length) return <div><h3 className={styles.sub}>{title}</h3><p className={styles.muted}>No photos.</p></div>;
    return <div>
        <h3 className={styles.sub}>{title}</h3>
        <div className={styles.photos}>{photos.map((photo, index) => <a key={photo.url ?? index} href={photo.url} target="_blank" rel="noreferrer"><img src={photo.url} alt={`${title} ${index + 1}`} loading="lazy" /></a>)}</div>
    </div>;
}

// The ruling form: how much of the deposit the lender keeps, and a message to both people.
function Ruling({ title, deposit, initial, submit, done }) {
    const action = useAction();
    const [forfeit, setForfeit] = useState(initial ?? '');
    const [message, setMessage] = useState('');
    return <Card title={title}>
        <form onSubmit={async event => { event.preventDefault(); if (await action.run(() => submit({ depositForfeit: Number(forfeit), message: message.trim() }))) done(); }}>
            <p className={styles.muted}>The deposit is {deposit} ₥. Whatever the lender keeps is moved now; the rest goes back to the borrower.</p>
            <FormField label="Lender keeps (₥)" name="depositForfeit" type="number" min="0" max={deposit} step="0.01" value={forfeit} required onChange={event => setForfeit(event.target.value)} />
            <FormField label="Message to both" name="rulingMessage" as="textarea" value={message} required onChange={event => setMessage(event.target.value)} />
            <Message type="error">{action.error}</Message>
            <Button type="submit" pending={action.pending} disabled={forfeit === '' || !message.trim()}>{title}</Button>
        </form>
    </Card>;
}

export default function AdminDamageCasePage() {
    const { id } = useParams();
    const { data, error, loading, reload } = useAsync(() => getDamageCase(id), [id]);
    if (loading && !data) return <Spinner />;
    const reservation = data?.reservation;
    const deposit = reservation?.payment?.depositAmount ?? 0;
    const decision = data?.steps.find(step => step.type === 'decision');
    return <>
        <PageHeader title={`Damage case ${id}`} backTo="/admin/reports" backLabel="Back to reports"
            actions={data && <Button variant="secondary" size="small" href={damageCasePdfUrl(id)} target="_blank" rel="noreferrer">Download PDF</Button>} />
        <Message type="error">{error}</Message>
        {data && <>
            <Card title="Case">
                <DetailList rows={[
                    ['Status', data.status],
                    ['Item', reservation.item?.name ?? 'Item no longer listed'],
                    ['Reservation', reservation._id],
                    ['Borrower', reservation.borrower],
                    ['Lender', reservation.lender],
                    ['Deposit', `${deposit} ₥`]
                ]} />
            </Card>
            <Card title="What happened">
                <ol className={styles.steps}>
                    {data.steps.map(step => <li key={step._id ?? step.type}>
                        <strong>{STEP_LABELS[step.type] ?? step.type}</strong>
                        <span className={styles.muted}>{formatDateTime(step.report?.date ?? step.createdAt)}{step.depositForfeit != null ? ` · lender keeps ${step.depositForfeit} ₥` : ''}</span>
                        {step.returnCondition && <span>Condition: {step.returnCondition}</span>}
                        {step.report?.message && <p>{step.report.message}</p>}
                        {step.report?.photos?.length > 0 && <div className={styles.photos}>{step.report.photos.map((photo, index) => <a key={photo.url ?? index} href={photo.url} target="_blank" rel="noreferrer"><img src={photo.url} alt={`${step.type} photo ${index + 1}`} loading="lazy" /></a>)}</div>}
                    </li>)}
                </ol>
            </Card>
            <Card title="Condition photos"><div className={styles.pair}><Photos title="At pickup" photos={data.beforePhotos} /><Photos title="At return" photos={data.afterPhotos} /></div></Card>
            {data.status === 'report' && <Ruling title="Decide" deposit={deposit} submit={body => decideDamageCase(id, body)} done={reload} />}
            {data.status === 'dispute' && <Ruling title="Final ruling" deposit={deposit} initial={decision?.depositForfeit} submit={body => resolveDamageCase(id, body)} done={reload} />}
            {data.status === 'decision' && <Message type="info">Waiting for the borrower. If nobody disputes within 7 days, the decision becomes final by itself.</Message>}
        </>}
    </>;
}
