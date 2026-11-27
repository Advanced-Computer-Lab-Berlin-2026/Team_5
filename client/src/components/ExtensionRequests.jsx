import { useState } from 'react';
import { Link } from 'react-router-dom';
import { getItem } from '../api/items.js';
import { decideExtension, listPendingExtensions } from '../api/lenderReservations.js';
import { useAction } from '../hooks/useAction.js';
import { useAsync } from '../hooks/useAsync.js';
import { formatDate } from '../utils/format.js';
import { Button } from './Button.jsx';
import { Message } from './Message.jsx';
import { UserReviewsDialog } from './UserReviewsDialog.jsx';
import styles from './ExtensionRequests.module.css';

// the list only carries the item's id, so each row looks up the item's name
function ItemName({ id }) {
    const item = useAsync(() => getItem(id), [id]);
    return item.data?.item?.name ?? 'Item';
}

// Lender: borrowers asking to keep something longer. Accepting moves the booking's last day; either way the borrower is told.
export function ExtensionRequests() {
    const { data, error, reload } = useAsync(listPendingExtensions);
    const decide = useAction();
    const [busy, setBusy] = useState('');
    const [reviewsOf, setReviewsOf] = useState('');
    const requests = data?.requests ?? [];

    async function handle(request, decision) {
        setBusy(request.requestId + decision);
        const ok = await decide.run(() => decideExtension(request.reservationId, request.requestId, decision),
            decision === 'accept' ? 'Accepted. The new last day is saved and the borrower has been told.' : 'Declined. The borrower has been told.');
        setBusy('');
        if (ok) reload();
    }

    if (!requests.length && !error && !decide.success && !decide.error) return null;
    return <section className={styles.section} aria-label="Extension requests">
        <h2>Asking for more days <span className={styles.count}>{requests.length}</span></h2>
        <Message type="error">{error || decide.error}</Message>
        <Message type="success">{decide.success}</Message>
        <div className={styles.list}>
            {requests.map(request => <article key={request.requestId} className={styles.card}>
                <div className={styles.text}>
                    <h3><ItemName id={request.item} /></h3>
                    <p><button type="button" className={styles.link} onClick={() => setReviewsOf(request.borrower)}>{request.borrower}</button> wants to keep it until <strong>{formatDate(request.requestedEndDate)}</strong> instead of {formatDate(request.originalEndDate)}.</p>
                    <Link className={styles.link} to={`/reservations/${request.reservationId}`}>Open the reservation</Link>
                </div>
                <div className={styles.buttons}>
                    <Button pending={busy === request.requestId + 'accept'} disabled={decide.pending} onClick={() => handle(request, 'accept')}>Accept</Button>
                    <Button variant="secondary" pending={busy === request.requestId + 'reject'} disabled={decide.pending} onClick={() => handle(request, 'reject')}>Decline</Button>
                </div>
            </article>)}
        </div>
        <UserReviewsDialog username={reviewsOf} onClose={() => setReviewsOf('')} />
    </section>;
}
