import { useState } from 'react';
import { cancelMembership, getMyMembership, listMembershipTiers, subscribeToTier } from '../api/membership.js';
import { newIdempotencyKey } from '../api/checkout.js';
import { getWalletBalance } from '../api/wallet.js';
import { useAction } from '../hooks/useAction.js';
import { useAsync } from '../hooks/useAsync.js';
import { Button, ConfirmDialog, Message, PageHeader, Spinner } from '../components';
import { CardPaymentDialog } from '../components/CardPaymentDialog.jsx';
import TiltedCard from '../components/TiltedCard.jsx';
import { formatDate } from '../utils/format.js';
import { cardPaymentsAvailable } from '../utils/stripe.js';
import styles from './MembershipPage.module.css';

// How many bookings each plan may have open at once. The server keeps this in MAX_CONCURRENT_RESERVATIONS
// (server/services/membershipService.js) and does not send it, so it is repeated here; keep the two the same.
const OPEN_BOOKINGS = { Basic: 2, Plus: 3, Premium: 5 };
const POLL_MS = 1500;
const POLL_LIMIT = 40;
const money = value => `${Number(Number(value).toFixed(2))} ₥`;

// Members and lenders: the plans side by side as tilting cards. A paid plan is bought for a year from the wallet or by card,
// and gives a discount on every deposit. Cancelling goes back to Basic straight away, with no refund.
export default function MembershipPage() {
    const tiers = useAsync(listMembershipTiers);
    const mine = useAsync(getMyMembership);
    const wallet = useAsync(getWalletBalance);
    const pay = useAction();
    const cancel = useAction();
    const [buying, setBuying] = useState(null); // { tier, method } waiting for "are you sure"
    const [key, setKey] = useState(null);
    const [card, setCard] = useState(null); // the card payment in progress { tier, clientSecret, amount }
    const [waiting, setWaiting] = useState(false);
    const [notice, setNotice] = useState('');
    const [cancelling, setCancelling] = useState(false);

    const current = mine.data?.membership;
    const balance = wallet.data?.balance;

    function ask(tier, method) {
        pay.reset();
        setNotice('');
        setKey(newIdempotencyKey()); // a new attempt; pressing the confirm button again after a hiccup reuses it
        setBuying({ tier, method });
    }

    async function handleConfirm() {
        const { tier, method } = buying;
        const result = await pay.run(() => subscribeToTier(key, tier.tier, method));
        if (!result) return;
        setBuying(null);
        if (result.status === 'completed') {
            setNotice(`You are on ${tier.tier} now, until ${formatDate(result.membership?.renewalDate)}. ${money(tier.annual_fee)} was taken from your wallet.`);
            mine.reload();
            wallet.reload();
        } else if (result.clientSecret) {
            setCard({ tier, clientSecret: result.clientSecret, amount: result.amount });
        }
    }

    // Stripe accepted the card; the server switches the plan when Stripe tells it, so wait for the plan to change
    async function handleCardPaid() {
        const { tier } = card;
        setCard(null);
        setWaiting(true);
        for (let attempt = 0; attempt < POLL_LIMIT; attempt += 1) {
            try {
                const data = await getMyMembership();
                if (data.membership?.tier === tier.tier) {
                    setWaiting(false);
                    setNotice(`You are on ${tier.tier} now, until ${formatDate(data.membership.renewalDate)}.`);
                    mine.reload();
                    return;
                }
            } catch { /* keep waiting */ }
            await new Promise(resolve => window.setTimeout(resolve, POLL_MS));
        }
        setWaiting(false);
        setNotice('Your card payment went through. Your plan changes as soon as the payment is confirmed, which can take a minute.');
    }

    async function handleCancel() {
        const result = await cancel.run(() => cancelMembership());
        if (result) { setCancelling(false); setNotice('Your membership is cancelled. You are back on Basic.'); mine.reload(); }
    }

    if ((tiers.loading && !tiers.data) || (mine.loading && !mine.data)) return <Spinner />;

    return <>
        <PageHeader title="Membership" />
        <Message type="error">{tiers.error || mine.error}</Message>
        <Message type="success">{notice}</Message>
        {waiting && <Message type="info">Waiting for the card payment to be confirmed…</Message>}
        {current && <p className={styles.lead}>You are on <strong>{current.tier}</strong>{current.renewalDate ? `, paid until ${formatDate(current.renewalDate)}` : ''}.{typeof balance === 'number' ? ` Your wallet has ${money(balance)}.` : ''}</p>}

        <div className={styles.grid}>
            {(tiers.data?.tiers ?? []).map((tier, index) => {
                const isCurrent = current?.tier === tier.tier;
                const paid = tier.annual_fee > 0;
                const enough = typeof balance === 'number' && balance >= tier.annual_fee;
                return <TiltedCard key={tier.tier} altText={`${tier.tier} plan`} showTooltip={false} containerWidth="100%" containerHeight="auto" imageWidth="100%" imageHeight="100%"
                    style={{ aspectRatio: '3 / 4' }} radius={12} rotateAmplitude={isCurrent ? 6 : 10} scaleOnHover={1.03} glare={0.3} shadow={0.35} parallax={0} introDelay={index * 80}>
                    <article className={`${styles.plan} ${isCurrent ? styles.current : ''} ${tier.tier === 'Premium' ? styles.premium : ''}`}>
                        {isCurrent && <span className={styles.badge}>Your plan</span>}
                        <h2 className={styles.name}>{tier.tier}</h2>
                        <p className={styles.price}>{paid ? <>{money(tier.annual_fee)}<span> a year</span></> : 'Free'}</p>
                        <ul className={styles.perks}>
                            <li><strong>{tier.deposit_discount}%</strong> off every deposit</li>
                            {OPEN_BOOKINGS[tier.tier] && <li>Up to <strong>{OPEN_BOOKINGS[tier.tier]}</strong> bookings open at once</li>}
                            <li>{paid ? 'Renews after a year' : 'Always included'}</li>
                        </ul>
                        <div className={styles.actions}>
                            {paid && !isCurrent && <>
                                <Button fullWidth disabled={!enough || waiting} onClick={() => ask(tier, 'wallet')}>Pay from wallet</Button>
                                <Button variant="secondary" fullWidth disabled={!cardPaymentsAvailable || waiting} onClick={() => ask(tier, 'card')}>Pay by card</Button>
                                {typeof balance === 'number' && !enough && <p className={styles.note}>Not enough in your wallet.</p>}
                            </>}
                            {paid && isCurrent && <Button variant="destructive" fullWidth onClick={() => { cancel.reset(); setCancelling(true); }}>Cancel membership</Button>}
                            {!paid && !isCurrent && <p className={styles.note}>You move back here if you cancel a paid plan.</p>}
                        </div>
                    </article>
                </TiltedCard>;
            })}
        </div>
        {!cardPaymentsAvailable && <p className={styles.note}>Card payments are not set up on this site yet.</p>}

        <ConfirmDialog open={Boolean(buying)} tone="dark" title={buying ? `Switch to ${buying.tier.tier}?` : ''} pending={pay.pending} error={pay.error}
            confirmLabel={buying?.method === 'card' ? 'Go to card payment' : `Pay ${buying ? money(buying.tier.annual_fee) : ''}`} cancelLabel="Not now"
            onConfirm={handleConfirm} onClose={() => setBuying(null)}>
            {buying && <>{money(buying.tier.annual_fee)} for a year, {buying.method === 'wallet' ? 'taken from your wallet' : 'paid by card'}. Every deposit is then {buying.tier.deposit_discount}% cheaper.{current && current.tier !== 'Basic' ? ` This replaces your ${current.tier} plan; nothing is refunded for it.` : ''}</>}
        </ConfirmDialog>
        <ConfirmDialog open={cancelling} title="Cancel your membership?" confirmLabel="Yes, cancel it" cancelLabel="Keep it" pending={cancel.pending} error={cancel.error}
            onConfirm={handleCancel} onClose={() => setCancelling(false)}>
            You go back to Basic straight away. The rest of this year is not refunded.
        </ConfirmDialog>
        <CardPaymentDialog open={Boolean(card)} clientSecret={card?.clientSecret} amountLabel={card ? `${money(card.amount / 100)} for a year of ${card.tier.tier}` : ''}
            onPaid={handleCardPaid} onClose={() => setCard(null)} />
    </>;
}
