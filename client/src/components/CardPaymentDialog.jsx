import { useEffect, useRef, useState } from 'react';
import { useCardTilt } from '../hooks/useCardTilt.js';
import { loadStripe } from '../utils/stripe.js';
import { Button } from './Button.jsx';
import { Message } from './Message.jsx';
import styles from './ReserveDialog.module.css';

// The amber card where the card number is typed. Stripe draws the card field itself (so the number never touches our code);
// pressing Pay confirms the payment with Stripe, then onPaid() lets the page wait for the server to make the bookings.
export function CardPaymentDialog({ open, clientSecret, amountLabel, onPaid, onClose }) {
    const dialog = useRef(null);
    const mountRef = useRef(null);
    const stripeRef = useRef(null);
    const cardRef = useRef(null);
    useCardTilt(dialog);
    const [ready, setReady] = useState(false);
    const [error, setError] = useState('');
    const [paying, setPaying] = useState(false);

    useEffect(() => {
        const element = dialog.current;
        if (!element) return undefined;
        if (open) {
            delete element.dataset.closing;
            if (!element.open) element.showModal();
            return undefined;
        }
        if (!element.open) return undefined;
        element.dataset.closing = 'true';
        const timer = window.setTimeout(() => { element.close(); delete element.dataset.closing; }, 200);
        return () => window.clearTimeout(timer);
    }, [open]);

    // mount Stripe's card field while the dialog is open
    useEffect(() => {
        if (!open || !clientSecret) return undefined;
        let card;
        let cancelled = false;
        setReady(false);
        setError('');
        loadStripe().then(stripe => {
            if (cancelled || !mountRef.current) return;
            stripeRef.current = stripe;
            card = stripe.elements().create('card', { hidePostalCode: true, style: { base: { fontSize: '16px', color: '#141414', '::placeholder': { color: '#6b5a40' } }, invalid: { color: '#8a1f1f' } } });
            card.mount(mountRef.current);
            card.on('ready', () => setReady(true));
            card.on('change', event => setError(event.error?.message ?? ''));
            cardRef.current = card;
        }).catch(failure => setError(failure.message));
        return () => { cancelled = true; card?.destroy(); cardRef.current = null; };
    }, [open, clientSecret]);

    async function handlePay(event) {
        event.preventDefault();
        if (!stripeRef.current || !cardRef.current) return;
        setPaying(true);
        setError('');
        try {
            const result = await stripeRef.current.confirmCardPayment(clientSecret, { payment_method: { card: cardRef.current } });
            if (result.error) setError(result.error.message ?? 'The card was not accepted.');
            else if (['succeeded', 'processing'].includes(result.paymentIntent?.status)) onPaid();
            else setError('The card payment has not been confirmed.');
        } catch (failure) {
            setError(failure.message);
        } finally {
            setPaying(false);
        }
    }

    return <dialog ref={dialog} className={styles.dialog} aria-label="Pay by card"
        onCancel={event => { event.preventDefault(); if (!paying) onClose(); }} onClose={onClose}>
        <form onSubmit={handlePay}>
            <h2>Pay by card</h2>
            <p>{amountLabel}</p>
            <div ref={mountRef} className={styles.cardField} />
            <Message type="error">{error}</Message>
            <Button type="submit" fullWidth pending={paying} disabled={!ready}>Pay</Button>
            <div className={styles.footer}>
                <button type="button" className={styles.textButton} disabled={paying} onClick={onClose}>Cancel</button>
            </div>
        </form>
    </dialog>;
}
