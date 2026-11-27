import { useState } from 'react';
import { getUserReviews } from '../api/reviews.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { formatDate } from '../utils/format.js';
import { AmberDialog } from './AmberDialog.jsx';
import { ReportDialog } from './ReportDialog.jsx';
import { Spinner } from './Spinner.jsx';
import { StarRating } from './StarRating.jsx';
import styles from './UserReviewsDialog.module.css';
import dialogStyles from './ReserveDialog.module.css';

// Someone's trust score and the reviews they got, on the amber card. Members can report the person from here.
export function UserReviewsDialog({ username, onClose }) {
    const { role } = useAuth();
    const open = Boolean(username);
    const data = useAsync(() => (username ? getUserReviews(username) : Promise.resolve(null)), [username]);
    const [reporting, setReporting] = useState(false);
    const user = data.data?.user;
    const reviews = data.data?.reviews ?? [];
    const average = reviews.length ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length : 0;

    return <>
        {/* while the report card is up, this one closes for a moment; that must not count as closing the whole thing */}
        <AmberDialog open={open && !reporting} label={`Reviews for ${username}`} onClose={() => { if (!reporting) onClose(); }}>
            <div className={styles.body}>
                {data.loading && !data.data && <Spinner />}
                {data.error && <p>{data.error}</p>}
                {user && <>
                    <h2>{user.name ?? user.username}</h2>
                    <p className={styles.meta}>@{user.username} · {user.role} · trust score <strong>{user.trustScore ?? '–'}</strong></p>
                    {reviews.length > 0 && <div className={styles.average}><StarRating readOnly value={Math.round(average)} label="Average rating" /> <span>{average.toFixed(1)} from {reviews.length} {reviews.length === 1 ? 'review' : 'reviews'}</span></div>}
                    {reviews.length === 0 ? <p className={styles.meta}>No reviews yet.</p> : <ul className={styles.list}>
                        {reviews.map(review => <li key={review.reservationId}>
                            <div className={styles.head}><StarRating readOnly value={review.rating} label="Rating" /><span>{review.reviewer}, as {review.role === 'lender' ? 'lender' : 'borrower'} · {formatDate(review.date)}</span></div>
                            <p>{review.review}</p>
                        </li>)}
                    </ul>}
                </>}
                <div className={dialogStyles.footer}>
                    {role === 'member' && user && <button type="button" className={dialogStyles.textButton} onClick={() => setReporting(true)}>Report this person</button>}
                    <button type="button" className={dialogStyles.textButton} onClick={onClose}>Close</button>
                </div>
            </div>
        </AmberDialog>
        {role === 'member' && <ReportDialog open={open && reporting} targetType="user" targetId={username} name={user?.name ?? username} onClose={() => setReporting(false)} />}
    </>;
}
