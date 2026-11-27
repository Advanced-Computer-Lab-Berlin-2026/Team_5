import { useEffect, useMemo, useState } from 'react';
import { getBorrowList, removeFromBorrowList, updateBorrowListDates } from '../api/borrowList.js';
import { getCardPaymentStatus, newIdempotencyKey, payWithWallet, startCardPayment, validatePromoCode } from '../api/checkout.js';
import { getWalletBalance } from '../api/wallet.js';
import { useAction } from '../hooks/useAction.js';
import { useAsync } from '../hooks/useAsync.js';
import { Button, Card, EmptyState, FormField, Icon, ItemCard, Message, PageHeader, Spinner } from '../components';
import { announceBorrowListChange } from '../components/BorrowBasket.jsx';
import { CardPaymentDialog } from '../components/CardPaymentDialog.jsx';
import { DatesDialog } from '../components/DatesDialog.jsx';
import { formatDate } from '../utils/format.js';
import { cardPaymentsAvailable } from '../utils/stripe.js';
import styles from './BorrowListPage.module.css';

// the same rounding as the server (checkoutPricingService): the promo comes off every item, rounded to the cent
const discounted = (deposit, percent) => Math.round((deposit - Math.round(deposit * percent) / 100) * 100) / 100;
const money = value => `${Number(value.toFixed(2))} ₥`;
// "busy, try again" answers: the same attempt (and key) is sent again
const RETRY_CODES = ['CHECKOUT_RETRY', 'CHECKOUT_CONFLICT'];
const POLL_MS = 1500;
const POLL_LIMIT = 40;

// Members: everything they want to borrow, with its dates, paid for in one go from the wallet or by card.
// Paying makes one booking request per item; each owner then approves or declines theirs (a declined one is refunded).
export default function BorrowListPage() {
    const list = useAsync(getBorrowList);
    // keep the basket in the header in step with this page
    useEffect(() => { if (list.data) announceBorrowListChange(); }, [list.data]);
    const wallet = useAsync(getWalletBalance);
    const removal = useAction();
    const promo = useAction();
    const pay = useAction();
    const [editing, setEditing] = useState(null);
    const [promoText, setPromoText] = useState('');
    const [applied, setApplied] = useState(null); // { code, percent }
    const [attemptKey, setAttemptKey] = useState(null);
    const [card, setCard] = useState(null); // { paymentId, clientSecret, amount }
    const [waiting, setWaiting] = useState(false);
    const [done, setDone] = useState(null); // { count, total, method }
    const [refunded, setRefunded] = useState(false);

    const entries = useMemo(() => list.data?.borrowList ?? [], [list.data]);
    const subtotal = entries.reduce((sum, entry) => sum + (entry.item.depositAmount ?? 0), 0);
    const total = applied ? entries.reduce((sum, entry) => sum + discounted(entry.item.depositAmount ?? 0, applied.percent), 0) : subtotal;
    const balance = wallet.data?.balance;
    const enoughInWallet = typeof balance === 'number' && balance >= total;
    // a different list or promo is a different payment, so it gets a new key
    const signature = entries.map(entry => `${entry.item._id}:${entry.startDate}:${entry.endDate}`).join('|') + (applied?.code ?? '');
    useEffect(() => { setAttemptKey(null); }, [signature]);
    const keyFor = () => { const key = attemptKey ?? newIdempotencyKey(); setAttemptKey(key); return key; };

    async function handleApplyPromo(event) {
        event.preventDefault();
        if (!entries.length || !promoText.trim()) return;
        // the server checks the code against the cheapest item, then takes the percentage off every item
        const cheapest = entries.reduce((low, entry) => (entry.item.depositAmount < low.item.depositAmount ? entry : low));
        const result = await promo.run(() => validatePromoCode(promoText.trim(), cheapest.item._id));
        if (result) setApplied({ code: result.code ?? promoText.trim().toUpperCase(), percent: result.discountPercent });
    }

    function finished(count, paid, method) {
        setDone({ count, total: paid, method });
        setApplied(null);
        setPromoText('');
        list.reload();
        wallet.reload();
    }

    async function handleWallet() {
        setRefunded(false);
        const key = keyFor();
        const result = await pay.run(() => payWithWallet(key, applied?.code));
        if (result) finished(result.reservations?.length ?? entries.length, result.totalDeposit ?? total, 'wallet');
    }

    async function handleCard() {
        setRefunded(false);
        const key = keyFor();
        const result = await pay.run(() => startCardPayment(key, applied?.code));
        if (result) setCard(result);
    }

    // Stripe said yes; the server makes the bookings when Stripe tells it, so wait for that
    async function handleCardPaid() {
        const paid = card;
        setCard(null);
        setWaiting(true);
        for (let attempt = 0; attempt < POLL_LIMIT; attempt += 1) {
            try {
                const status = await getCardPaymentStatus(paid.paymentId);
                if (status.status === 'completed') { setWaiting(false); finished(status.reservations?.length ?? entries.length, paid.amount / 100, 'card'); return; }
                if (status.status === 'refunded' || status.status === 'refund_pending') {
                    setWaiting(false);
                    pay.reset();
                    setRefunded(true);
                    list.reload();
                    return;
                }
            } catch { /* keep waiting */ }
            await new Promise(resolve => window.setTimeout(resolve, POLL_MS));
        }
        setWaiting(false);
        setDone({ count: entries.length, total: paid.amount / 100, method: 'card', pending: true });
    }

    // a retryable answer keeps the key so pressing pay again repeats the same attempt; anything else starts fresh next time
    useEffect(() => { if (pay.error && !RETRY_CODES.includes(pay.errorCode)) setAttemptKey(null); }, [pay.error, pay.errorCode]);

    return <>
        <PageHeader title="Borrow list" />
        {list.loading && !list.data && <Spinner />}
        <Message type="error">{list.error || removal.error}</Message>

        {done && <Card title={done.pending ? 'Payment received' : 'Requests sent'} className={styles.done}>
            <p>{done.pending
                ? 'Your card payment went through. The booking requests appear in My bookings as soon as the payment is confirmed, which can take a minute.'
                : `You paid ${money(done.total)} ${done.method === 'wallet' ? 'from your wallet' : 'by card'} for ${done.count} ${done.count === 1 ? 'item' : 'items'}. Each owner will now approve or decline. A declined request is refunded to your wallet.`}</p>
            <Button to="/bookings">See my bookings <Icon name="arrow" size={16} /></Button>
        </Card>}

        {list.data && entries.length === 0 && !done && <EmptyState featured icon="box" title="Your borrow list is empty"
            description="Pick dates on an item and press Reserve to add it here. When you are ready, pay for everything at once."
            action={<Button to="/items">Start discovering <Icon name="arrow" size={16} /></Button>} />}

        {entries.length > 0 && <div className={styles.layout}>
            <div className={styles.items}>
                {entries.map((entry, index) => <ItemCard key={entry.item._id} item={entry.item} introDelay={index * 60} showView plainBack
                    subtitle={`${formatDate(entry.startDate)} to ${formatDate(entry.endDate)}`}
                    extra={`${formatDate(entry.startDate)} to ${formatDate(entry.endDate)}`}
                    details={applied ? [['After promo', money(discounted(entry.item.depositAmount, applied.percent))]] : []}
                    actions={<>
                        <Button variant="secondary" size="small" onClick={() => setEditing(entry)}>Change dates</Button>
                        <Button variant="destructive" size="small" disabled={removal.pending}
                            onClick={async () => { if (await removal.run(() => removeFromBorrowList(entry.item._id))) list.reload(); }}>Remove</Button>
                    </>} />)}
            </div>

            <Card title="Checkout" className={styles.checkout}>
                <dl className={styles.sums}>
                    <div><dt>{entries.length} {entries.length === 1 ? 'item' : 'items'}</dt><dd>{money(subtotal)}</dd></div>
                    {applied && <div><dt>Promo {applied.code} (−{applied.percent}%)</dt><dd>−{money(subtotal - total)}</dd></div>}
                    <div className={styles.total}><dt>Deposit to pay</dt><dd>{money(total)}</dd></div>
                    {typeof balance === 'number' && <div><dt>In your wallet</dt><dd>{money(balance)}</dd></div>}
                </dl>
                <p className={styles.note}>The deposit is held, not spent: you get it back when you return the items in good condition.</p>

                {applied
                    ? <div className={styles.promoApplied}><span>Promo <strong>{applied.code}</strong> applied</span><button type="button" className={styles.link} onClick={() => { setApplied(null); promo.reset(); }}>Remove</button></div>
                    : <form className={styles.promo} onSubmit={handleApplyPromo}>
                        <FormField label="Promo code" name="promoCode" value={promoText} onChange={event => setPromoText(event.target.value)} />
                        <Button type="submit" variant="secondary" pending={promo.pending} disabled={!promoText.trim()}>Apply</Button>
                    </form>}
                <Message type="error">{promo.error}</Message>

                <Message type="error">{pay.error}</Message>
                {refunded && <Message type="error">One of the items was booked by someone else while you paid, so your card was refunded. Check your list and try again.</Message>}
                {waiting && <Message type="info">Waiting for the card payment to be confirmed…</Message>}
                <div className={styles.payButtons}>
                    <Button pending={pay.pending && !card} disabled={pay.pending || waiting || !enoughInWallet} onClick={handleWallet}>Pay {money(total)} from wallet</Button>
                    <Button variant="secondary" disabled={pay.pending || waiting || !cardPaymentsAvailable} onClick={handleCard}>Pay by card</Button>
                </div>
                {typeof balance === 'number' && !enoughInWallet && <p className={styles.note}>Your wallet has {money(balance)}, which is not enough. Pay by card instead.</p>}
                {!cardPaymentsAvailable && <p className={styles.note}>Card payments are not set up on this site yet.</p>}
            </Card>
        </div>}

        <DatesDialog entry={editing} onClose={() => setEditing(null)}
            onSave={async dates => { await updateBorrowListDates(editing.item._id, dates); list.reload(); }} />
        <CardPaymentDialog open={Boolean(card)} clientSecret={card?.clientSecret} amountLabel={card ? `${money(card.amount / 100)} for ${entries.length} ${entries.length === 1 ? 'item' : 'items'}` : ''}
            onPaid={handleCardPaid} onClose={() => { setCard(null); pay.reset(); }} />
    </>;
}
