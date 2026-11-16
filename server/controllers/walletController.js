import { User } from '../models/User.js';
import { checkoutWithWallet } from '../services/checkoutService.js';
import { CheckoutError } from '../utils/CheckoutError.js';

// GET /api/wallet
export async function getWalletBalance(req, res, next) {
    try {

         const userId = req.user?.id;

        const user = await User.findById(userId).select('wallet');
        if (!user) return res.status(401).json({ message: 'User not found' });

        return res.status(200).json({ balance: user.wallet });
    } catch (error) {
        next(error);
    }
}


export async function payWalletCheckout(req, res, next) {
    try {
        const userId = req.user.id;
        const idempotencyKey = req.get('Idempotency-Key');
        const promoCode = req.body?.promoCode;

        if (
            promoCode !== undefined &&
            (typeof promoCode !== 'string' || !promoCode.trim())
        ) {
            return res.status(400).json({
                error: 'INVALID_PROMO_CODE',
                message: 'Promo code must be a non-empty string.'
            });
        }

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

        const result = await checkoutWithWallet(
            userId,
            idempotencyKey.trim(),
            promoCode?.trim().toUpperCase() ?? null
        );

        return res.status(result.replayed ? 200 : 201).json(result);

    } catch (error) {

        // Expected checkout errors
        if (error instanceof CheckoutError) {
            return res.status(error.statusCode).json({
                error: error.code,
                message: error.message
            });
        }

        // A concurrent checkout may have used the same key
        if (error.code === 11000) {
            return res.status(409).json({
                error: 'CHECKOUT_CONFLICT',
                message: 'Checkout conflict. Retry using the same Idempotency-Key.'
            });
        }

        // A transaction may have failed temporarily
        if (
            error.hasErrorLabel?.('TransientTransactionError') ||
            error.hasErrorLabel?.('UnknownTransactionCommitResult')
        ) {
            return res.status(503).json({
                error: 'CHECKOUT_RETRY',
                message: 'Checkout could not be confirmed. Retry using the same Idempotency-Key.'
            });
        }

        // Unexpected errors
        return next(error);
    }
}
