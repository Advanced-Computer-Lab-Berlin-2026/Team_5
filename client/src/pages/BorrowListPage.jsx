import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getBorrowList, removeFromBorrowList, updateBorrowListDates } from '../api/borrowList.js';
import { getCardPaymentStatus, newIdempotencyKey, payWithWallet, reconcileCardPayment, startCardPayment, quoteCheckout } from '../api/checkout.js';
import { getWalletBalance } from '../api/wallet.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useAction } from '../hooks/useAction.js';
import { useAsync } from '../hooks/useAsync.js';
import { Button, Card, EmptyState, FormField, Icon, ItemCard, Message, PageHeader, Spinner } from '../components';
import { announceBorrowListChange } from '../components/BorrowBasket.jsx';
import { CardPaymentDialog } from '../components/CardPaymentDialog.jsx';
import { DatesDialog } from '../components/DatesDialog.jsx';
import { formatDate } from '../utils/format.js';
import { cardPaymentsAvailable } from '../utils/stripe.js';
import { useDepositRates } from '../hooks/useDepositRates.js';
import styles from './BorrowListPage.module.css';

// the same rounding as the server (checkoutPricingService): the promo comes off every item, rounded to the cent
const money = value => Number(Number(value).toFixed(2)) + ' ₥';
// "busy, try again" answers: the same attempt (and key) is sent again
const RETRY_CODES = ['CHECKOUT_RETRY', 'CHECKOUT_CONFLICT'];
const POLL_MS = 1500;
const POLL_LIMIT = 40;

function readCardAttempt(storageKey) {
    try {
        return JSON.parse(sessionStorage.getItem(storageKey));
    } catch {
        return null;
    }
}

// Members: everything they want to borrow, with its dates, paid for in one go from the wallet or by card.
// Paying makes one booking request per item; each owner then approves or declines theirs (a declined one is refunded).
export default function BorrowListPage() {
    const { user } = useAuth();
    const storageKey = `acl.card-checkout.${user?.id ?? user?.username}`;
    const list = useAsync(getBorrowList);
    // keep the basket in the header in step with this page
    useEffect(() => { if (list.data) announceBorrowListChange(); }, [list.data]);
    const wallet = useAsync(getWalletBalance);
    const removal = useAction();
    const promo = useAction();
    const pay = useAction();
    const [editing, setEditing] = useState(null);
    // ?edit=ITEM-ID (from "Change its dates" in the reserve card) opens that item's change-dates card straight away
    const [params, setParams] = useSearchParams();
    const editId = params.get('edit');
    const [promoText, setPromoText] = useState('');
    const [applied, setApplied] = useState(null); // { code, percent }
    const [attemptKey, setAttemptKey] = useState(null);
    const [card, setCard] = useState(null); // { paymentId, clientSecret, amount }
    const [pendingCard, setPendingCard] = useState(() => {
        const attempt = readCardAttempt(storageKey);
        return attempt?.confirming ? attempt : null;
    });
    const [pollTimedOut, setPollTimedOut] = useState(false);
    const [done, setDone] = useState(null); // { count, total, method }
    const [refunded, setRefunded] = useState(false);

    const { depositOf, rateOf } = useDepositRates();
    const entries = useMemo(() => list.data?.borrowList ?? [], [list.data]);
    useEffect(() => {
        if (!editId || !list.data) return;
        const match = entries.find(entry => entry.item._id === editId);
        if (match) setEditing(match);
        setParams(current => { const next = new URLSearchParams(current); next.delete('edit'); return next; }, { replace: true });
    }, [editId, list.data, entries, setParams]);
    // each item's deposit as it will be charged: the listed deposit × its category's deposit rate (before any membership discount)
    const priceOf = entry => depositOf(entry.item);
    const listed = entries.reduce((sum, entry) => sum + (entry.item.depositAmount ?? 0), 0);
    const subtotal = entries.reduce((sum, entry) => sum + priceOf(entry), 0);
    const quote = useAsync(() => entries.length ? quoteCheckout(applied?.code) : Promise.resolve(null), [entries, applied?.code]);
    const total = quote.data?.total;
    const paymentDisabled = Boolean(pendingCard) || list.loading || quote.loading || Boolean(quote.error) || typeof total !== 'number';
    const balance = wallet.data?.balance;
    const enoughInWallet = typeof balance === 'number' && balance >= total;
    // a different list or promo is a different payment, so it gets a new key
    const signature = JSON.stringify([applied?.code, entries.map(entry => [
        entry.item._id, entry.startDate, entry.endDate, entry.deliveryAddress
    ])]);
    useEffect(() => { setAttemptKey(null); }, [signature]);
    const keyFor = () => { const key = attemptKey ?? newIdempotencyKey(); setAttemptKey(key); return key; };

    async function handleApplyPromo(event) {
        event.preventDefault();
        if (!entries.length || !promoText.trim()) return;
        // the server checks the code against the cheapest item, then takes the percentage off every item
        const result = await promo.run(() => quoteCheckout(promoText.trim()));
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
        if (readCardAttempt(storageKey)?.confirming) return;
        setRefunded(false);
        const key = keyFor();
        const result = await pay.run(() => payWithWallet(key, applied?.code));
        if (result) finished(result.reservations?.length ?? entries.length, result.total ?? result.totalDeposit, 'wallet');
    }

    async function handleCard() {
        setRefunded(false);
        const saved = readCardAttempt(storageKey);
        const attempt = saved?.confirming || saved?.signature === signature
            ? saved
            : { key: newIdempotencyKey(), signature, promoCode: applied?.code };
        const result = await pay.run(async () => {
            sessionStorage.setItem(storageKey, JSON.stringify(attempt));
            return startCardPayment(attempt.key, attempt.promoCode);
        });
        if (result) setCard({ ...result, attempt });
        else if (attempt.confirming) setPollTimedOut(false);
    }

    function markCardConfirming() {
        const attempt = { ...card.attempt, paymentId: card.paymentId, confirming: true };
        sessionStorage.setItem(storageKey, JSON.stringify(attempt));
        setPendingCard(attempt);
        setPollTimedOut(false);
    }

    useEffect(() => {
        if (!pendingCard || card || pollTimedOut) return undefined;
        let active = true;
        let timer;
        let checks = 0;
        async function checkPayment() {
            try {
                const check = checks === 0 || checks % 10 === 0 ? reconcileCardPayment : getCardPaymentStatus;
                const status = await check(pendingCard.paymentId);
                if (!active) return;
                if (['completed', 'refunded', 'refund_pending', 'failed'].includes(status.status)) {
                    sessionStorage.removeItem(storageKey);
                    setPendingCard(null);
                    pay.reset();
                    if (status.status === 'completed') {
                        setDone({ count: status.reservations.length, total: status.amount / 100, method: 'card' });
                        setApplied(null);
                        setPromoText('');
                        wallet.reload();
                    } else {
                        setRefunded(status.status);
                    }
                    list.reload();
                    return;
                }
            } catch { /* keep waiting */ }
            if (!active) return;
            if (++checks >= POLL_LIMIT) setPollTimedOut(true);
            else timer = window.setTimeout(checkPayment, POLL_MS);
        }
        checkPayment();
        return () => {
            active = false;
            window.clearTimeout(timer);
        };
    }, [pendingCard, card, pollTimedOut, storageKey, pay.reset, wallet.reload, list.reload]);

    // Keep the key across ambiguous failures so a retry cannot create a second charge.
    useEffect(() => {
        if (['PAYMENT_NOT_CONFIRMABLE', 'PAYMENT_REQUIRES_RECONCILIATION'].includes(pay.errorCode)) return;
        if (pay.errorCode && !RETRY_CODES.includes(pay.errorCode) && !pendingCard) quote.reload();
    }, [pay.errorCode, quote.reload, pendingCard]);

    return <>
        <PageHeader title="Borrow list" />
        {list.loading && !list.data && <Spinner />}
        <Message type="error">{list.error || removal.error}</Message>

        {done && <Card title="Requests sent" className={styles.done}>
            <p>{`You paid ${money(done.total)} ${done.method === 'wallet' ? 'from your wallet' : 'by card'} for ${done.count} ${done.count === 1 ? 'item' : 'items'}. Each owner will now approve or decline. A declined request is refunded to your wallet.`}</p>
            <Button to="/bookings">See my bookings <Icon name="arrow" size={16} /></Button>
        </Card>}

        {pendingCard && <Message type="info">{pollTimedOut ? 'Checkout is still awaiting payment confirmation.' : 'Your card payment is being confirmed.'}</Message>}
        {pendingCard && pollTimedOut && <>
            <Button disabled={pay.pending} onClick={() => setPollTimedOut(false)}>Check payment status</Button>
            <Button variant="secondary" pending={pay.pending} onClick={handleCard}>Resume card payment</Button>
        </>}
        {pendingCard && !['PAYMENT_NOT_CONFIRMABLE', 'PAYMENT_NOT_PENDING'].includes(pay.errorCode) && <Message type="error">{pay.error}</Message>}
        {list.data && entries.length === 0 && !done && !pendingCard && <EmptyState featured icon="box" title="Your borrow list is empty"
            description="Pick dates on an item and press Reserve to add it here. When you are ready, pay for everything at once."
            action={<Button to="/items">Start discovering <Icon name="arrow" size={16} /></Button>} />}

        {entries.length > 0 && <div className={styles.layout}>
            <div className={styles.items}>
                {entries.map((entry, index) => <ItemCard key={entry.item._id} item={entry.item} introDelay={index * 60} showView plainBack
                    subtitle={`${formatDate(entry.startDate)} to ${formatDate(entry.endDate)}`}
                    extra={`${formatDate(entry.startDate)} to ${formatDate(entry.endDate)}`}
                    details={entry.deliveryAddress ? [['Delivery address', entry.deliveryAddress]] : []}
                    actions={<>
                        <Button variant="secondary" size="small" onClick={() => setEditing(entry)}>Change dates</Button>
                        <Button variant="destructive" size="small" disabled={removal.pending}
                            onClick={async () => { if (await removal.run(() => removeFromBorrowList(entry.item._id))) list.reload(); }}>Remove</Button>
                    </>} />)}
            </div>

            <Card title="Checkout" className={styles.checkout}>
                <dl className={styles.sums}>
                    {/* each item: listed deposit × its category's rate = what it costs */}
                    {entries.map(entry => <div key={entry.item._id} className={styles.line}><dt>{entry.item.name}</dt><dd>{money(entry.item.depositAmount ?? 0)} × {rateOf(entry.item.category)} = {money(priceOf(entry))}</dd></div>)}
                    <div className={styles.sub}><dt>Listed deposits</dt><dd>{money(listed)}</dd></div>
                    <div><dt>After deposit rates</dt><dd>{money(subtotal)}</dd></div>
                    {quote.data && <div><dt>After membership and household discounts</dt><dd>{money(quote.data.originalTotal)}</dd></div>}
                    {applied && quote.data && <div><dt>Promo {applied.code}</dt><dd>{money(quote.data.originalTotal - quote.data.totalDeposit)} off</dd></div>}
                    {quote.data && <div><dt>Deposit</dt><dd>{money(quote.data.totalDeposit)}</dd></div>}
                    {quote.data?.deliveryFee > 0 && <div><dt>Delivery fees</dt><dd>{money(quote.data.deliveryFee)}</dd></div>}
                    <div className={styles.total}><dt>Total to pay</dt><dd>{typeof total === "number" ? money(total) : "..."}</dd></div>
                    {typeof balance === 'number' && <div><dt>In your wallet</dt><dd>{money(balance)}</dd></div>}
                </dl>
                <p className={styles.note}>Deposits include each category's deposit rate. Your membership and household discounts are included in the total. The deposit is held, not spent: you get it back when you return the items in good condition.</p>

                {applied
                    ? <div className={styles.promoApplied}><span>Promo <strong>{applied.code}</strong> applied</span><button type="button" className={styles.link} onClick={() => { setApplied(null); promo.reset(); }}>Remove</button></div>
                    : <form className={styles.promo} onSubmit={handleApplyPromo}>
                        <FormField label="Promo code" name="promoCode" value={promoText} onChange={event => setPromoText(event.target.value)} />
                        <Button type="submit" variant="secondary" pending={promo.pending} disabled={!promoText.trim()}>Apply</Button>
                    </form>}
                <Message type="error">{promo.error}</Message>

                <Message type="error">{quote.error || (!pendingCard && pay.error)}</Message>
                {refunded && <Message type="error">{refunded === 'failed' ? 'Your card payment did not go through.' : refunded === 'refund_pending' ? 'Your card refund is pending.' : 'Your card was refunded.'}</Message>}
                <div className={styles.payButtons}>
                    <Button pending={pay.pending && !card} disabled={paymentDisabled} onClick={handleWallet}>Pay from wallet</Button>
                    {cardPaymentsAvailable && <Button variant="secondary" disabled={pay.pending || paymentDisabled} onClick={handleCard}>Pay by card</Button>}
                </div>
                {typeof balance === 'number' && typeof total === "number" && !enoughInWallet && <p className={styles.note}>Your wallet has {money(balance)}, which may not be enough. If it is short, the payment is refused and nothing is taken.</p>}
            </Card>
        </div>}

        <DatesDialog entry={editing} onClose={() => setEditing(null)}
            onSave={async dates => { await updateBorrowListDates(editing.item._id, dates); list.reload(); }} />
        <CardPaymentDialog open={Boolean(card)} clientSecret={card?.clientSecret} amountLabel={card ? `${money(card.amount / 100)} for ${entries.length} ${entries.length === 1 ? 'item' : 'items'}` : ''}
            onConfirming={markCardConfirming} onPaid={() => setCard(null)} onClose={() => { setCard(null); pay.reset(); }} />
    </>;
}
