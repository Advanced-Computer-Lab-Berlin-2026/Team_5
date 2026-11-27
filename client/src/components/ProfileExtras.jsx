import { useState } from 'react';
import { applyReferralCode, getMyReferrals } from '../api/referrals.js';
import { getMyReviews } from '../api/reviews.js';
import { useAction } from '../hooks/useAction.js';
import { useAsync } from '../hooks/useAsync.js';
import { formatDate } from '../utils/format.js';
import { Button } from './Button.jsx';
import { Card } from './Card.jsx';
import { FormField } from './FormField.jsx';
import { Message } from './Message.jsx';
import { StarRating } from './StarRating.jsx';
import styles from './ProfileExtras.module.css';

// Your code to invite friends, who you invited, and (once) the code of whoever invited you.
export function ReferralCard() {
    const { data, error, reload } = useAsync(getMyReferrals);
    const apply = useAction();
    const [code, setCode] = useState('');
    const [copied, setCopied] = useState(false);
    const referrals = data?.referrals ?? [];

    async function copy() {
        try { await navigator.clipboard.writeText(data.referralCode); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { /* the code is on screen to copy by hand */ }
    }

    return <Card title="Invite friends" className={styles.card}>
        <Message type="error">{error}</Message>
        {data && <>
            <p className={styles.muted}>Give a friend your code. When they finish their first borrow, you get 50 ₥ in your wallet.</p>
            <div className={styles.code}><span>{data.referralCode}</span><Button variant="secondary" size="small" onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button></div>
            {referrals.length > 0 && <ul className={styles.list}>
                {referrals.map(referral => <li key={referral._id}>
                    <span>{referral.referred}</span>
                    <span className={referral.status === 'converted' ? styles.good : styles.muted}>{referral.status === 'converted' ? `Joined in · ${referral.creditsIssued ?? 0} ₥` : 'Invited'}</span>
                </li>)}
            </ul>}
            {data.referredBy
                ? <p className={styles.muted}>You were invited by <strong>{data.referredBy}</strong>.</p>
                : <form className={styles.apply} onSubmit={async event => { event.preventDefault(); if (await apply.run(() => applyReferralCode(code.trim()), 'Code saved. Your friend gets their credit after your first finished borrow.')) { setCode(''); reload(); } }}>
                    <FormField label="Were you invited? Enter their code" name="referralCode" value={code} onChange={event => setCode(event.target.value)} />
                    <Button type="submit" variant="secondary" pending={apply.pending} disabled={!code.trim()}>Save</Button>
                </form>}
            <Message type="error">{apply.error}</Message>
            <Message type="success">{apply.success}</Message>
        </>}
    </Card>;
}

// The reviews people left about you, and the ones you wrote, as two tabs.
export function MyReviewsCard() {
    const { data, error } = useAsync(getMyReviews);
    const [tab, setTab] = useState('received');
    const list = data?.[tab] ?? [];
    const average = data?.received?.length ? data.received.reduce((sum, review) => sum + review.rating, 0) / data.received.length : 0;
    return <Card title="Reviews" className={styles.card}>
        <Message type="error">{error}</Message>
        {data && <>
            {data.received.length > 0 && <div className={styles.average}><StarRating readOnly value={Math.round(average)} label="Your average" /><span>{average.toFixed(1)} from {data.received.length}</span></div>}
            <div className={styles.tabs} role="tablist">
                {[['received', `About you (${data.received.length})`], ['given', `By you (${data.given.length})`]].map(([value, label]) =>
                    <button key={value} type="button" role="tab" aria-selected={tab === value} className={`${styles.tab} ${tab === value ? styles.tabOn : ''}`} onClick={() => setTab(value)}>{label}</button>)}
            </div>
            {list.length === 0 ? <p className={styles.muted}>{tab === 'received' ? 'Nobody has reviewed you yet. Reviews come in after a finished borrow.' : 'You have not written a review yet. You can after a finished borrow.'}</p>
                : <ul className={styles.reviews}>
                    {list.map(review => <li key={`${review.reservationId}-${tab}`}>
                        <div className={styles.head}><StarRating readOnly value={review.rating} label="Rating" />
                            <span>{tab === 'received' ? `${review.reviewer}, about you as ${review.role}` : `For ${review.targetUser} (${review.targetRole})`} · {formatDate(review.date)}</span></div>
                        <p>{review.review}</p>
                    </li>)}
                </ul>}
        </>}
    </Card>;
}
