// Card payments go through Stripe. Stripe.js is loaded from Stripe's own site the first time a card payment starts
// (Stripe requires that, and it keeps it out of the main bundle). The publishable key (pk_test_...) is safe to ship to the
// browser; it is read from VITE_STRIPE_PUBLISHABLE_KEY in the project's .env.
const KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;

export const cardPaymentsAvailable = Boolean(KEY);

let loading = null;

export function loadStripe() {
    if (!KEY) return Promise.reject(new Error('Card payments are not set up yet (VITE_STRIPE_PUBLISHABLE_KEY is missing).'));
    loading ??= new Promise((resolve, reject) => {
        if (window.Stripe) { resolve(window.Stripe(KEY)); return; }
        const script = document.createElement('script');
        script.src = 'https://js.stripe.com/v3/';
        script.async = true;
        script.onload = () => resolve(window.Stripe(KEY));
        script.onerror = () => { loading = null; reject(new Error('Could not load the card form. Check your connection and try again.')); };
        document.head.append(script);
    });
    return loading;
}
