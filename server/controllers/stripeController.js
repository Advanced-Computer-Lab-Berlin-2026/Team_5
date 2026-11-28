
import stripe from '../config/stripe.js';
import { createCardPaymentIntent, finalizeCardPayment } from '../services/stripeCheckoutService.js';
import { CheckoutError } from '../utils/CheckoutError.js';
import { Payment } from '../models/Payment.js';
export async function createPaymentIntent(req, res, next) {
    try {
        const userId = req.user.id;
        const idempotencyKey = req.get('Idempotency-Key');

        if (
            typeof idempotencyKey !== 'string' ||
            !idempotencyKey.trim() ||
            idempotencyKey.trim().length > 128
        ) {
            return res.status(400).json({
                error: 'INVALID_IDEMPOTENCY_KEY',
                message: 'A valid Idempotency-Key header is required.'
            });
        }
        const promoCode = req.body?.promoCode ?? null;
        const result = await createCardPaymentIntent(
            userId,
            idempotencyKey.trim(),
            promoCode
        );

        return res.status(200).json(result);

    } catch (error) {
        if (error instanceof CheckoutError) {
            return res.status(error.statusCode).json({
                error: error.code,
                message: error.message
            });
        }

        return next(error);
    }
}

export async function getCardPaymentStatus(req, res, next) {
    try {
        const { paymentId } = req.params;

        if (!/^PAY-[a-zA-Z0-9_-]{1,100}$/.test(paymentId)) {
            return res.status(400).json({
                error: 'INVALID_PAYMENT_ID',
                message: 'Invalid payment ID.'
            });
        }

        const payment = await Payment.findOne({
            _id: paymentId,
            user: req.user.id,
            method: 'card'
        })
        .select('_id type status stripePaymentIntentId stripeAmountCents reservations updatedAt')
        .lean();

        if (!payment) {
            return res.status(404).json({
                error: 'PAYMENT_NOT_FOUND',
                message: 'Payment not found.'
            });
        }

        let status = payment.status;
        let reservations = payment.reservations || [];
        if (req.method === 'POST' && payment.type === 'deposit-pending' &&
            status === 'awaiting_payment' && payment.stripePaymentIntentId) {
            const intent = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId);
            if (intent.status === 'succeeded') {
                const result = await finalizeCardPayment(intent);
                status = result.status;
                reservations = result.reservations ?? reservations;
            } else if (intent.status === 'canceled') {
                status = 'failed';
            }
        }

        return res.status(200).json({
            paymentId: payment._id,
            status,
            amount: payment.stripeAmountCents,
            currency: 'eur',
            reservations,
            updatedAt: payment.updatedAt
        });

    } catch (error) {
        next(error);
    }
}
