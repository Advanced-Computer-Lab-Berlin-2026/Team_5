
import stripe from '../config/stripe.js';
import { env } from '../config/env.js';
import { finalizeCardPayment } from '../services/stripeCheckoutService.js';

export async function handleStripeWebhook(req, res) {
    const signature = req.get('stripe-signature');

    if (!env.stripeWebhookSecret) {
        return res.status(503).json({
            message: 'Stripe webhook is not configured.'
        });
    }

    let event;

    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            signature,
            env.stripeWebhookSecret
        );
    } catch {
        return res.status(400).json({
            message: 'Invalid Stripe webhook signature.'
        });
    }

    try {
        switch (event.type) {

            case 'payment_intent.succeeded': {
                const paymentIntent = event.data.object;

                // Ignore Stripe payments unrelated to ShareShed.
                if (!paymentIntent.metadata?.paymentId) {
                    return res.status(200).json({
                        received: true,
                        ignored: true
                    });
                }

                await finalizeCardPayment(paymentIntent);
                break;
            }

            case 'payment_intent.payment_failed': {
                // A failed card attempt can be retried using
                // the same PaymentIntent.
                // Keep the internal payment awaiting_payment.
                break;
            }

            default:
                break;
        }

        return res.status(200).json({
            received: true
        });

    } catch (error) {
        console.error(
            'Stripe webhook processing error:',
            error
        );

        // Stripe can retry unsuccessful webhook deliveries.
        return res.status(500).json({
            message: 'Webhook processing failed.'
        });
    }
}

