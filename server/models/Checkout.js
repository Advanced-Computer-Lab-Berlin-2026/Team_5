
import mongoose from 'mongoose';

const checkoutSchema = new mongoose.Schema(
    {
        user: {
            type: String,
            ref: 'User',
            required: true
        },

        idempotencyKey: {
            type: String,
            required: true,
            trim: true
        },

        method: {
            type: String,
            enum: ['wallet', 'card'],
            required: true
        },

        reservations: [{
            type: String,
            ref: 'Reservation'
        }],

        payments: [{
            type: String,
            ref: 'Payment'
        }],

        totalDeposit: {
            type: Number,
            required: true,
            min: 0
        },
        promoCode: { type: String, trim: true },
        originalTotal: { type: Number, min: 0 },
        promoDiscountPercent: { type: Number, min: 0, max: 100 },

        remainingBalance: {
            type: Number,
            min: 0
        }
    },
    { timestamps: true }
);

// Prevent the same user from completing the same checkout twice
checkoutSchema.index(
    { user: 1, idempotencyKey: 1 },
    { unique: true }
);

export const Checkout = mongoose.model('Checkout', checkoutSchema);
