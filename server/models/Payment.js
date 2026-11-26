import mongoose from "mongoose";
import crypto from "crypto";

// One document per transaction
const paymentSchema = new mongoose.Schema(
  {
    _id: { type: String, default: () => `PAY-${crypto.randomBytes(4).toString("hex")}` }, // transaction id
    user: { type: String, ref: "User", required: true },
    reservation: { type: String, ref: "Reservation" },
    type: {
      type: String,
      enum: ["deposit-pending","deposit-paid", "deposit-refund", "deposit-forfeit", "late-fee", "membership-fee", "referral-credit"],
      required: true,
    },
    amount: { type: Number, required: true, min: 0 },
    description: { type: String },
    direction: { type: String, enum: ["deduct", "receive"], required: true },
    method: { type: String, enum: ["wallet", "card"], required: true },
    date: { type: Date, default: Date.now },
    status: { type: String, enum: ['awaiting_payment', 'completed', 'refund_pending', 'refunded', 'failed'], default: 'completed' },
    checkoutKey: { type: String, trim: true },
    stripePaymentIntentId: { type: String },
    stripeAmountCents: { type: Number, min: 0 },
    
    checkoutItems: [{
        itemId: { type: String, ref: 'Item', required: true },
        lenderId: { type: String, ref: 'User', required: true },
        startDate: { type: Date, required: true },
        endDate: { type: Date, required: true },
        depositAmount: { type: Number, required: true, min: 0 },
        cancellationPolicy: {
            freeDays: { type: Number, min: 0 },
            forfeitPercent: { type: Number, min: 0, max: 100 }
        },
        _id: false
    }],

    reservations: [{ type: String, ref: 'Reservation' }],
    stripeRefundId: { type: String },
    promoCode: { type: String, trim: true },
    originalTotal: { type: Number, min: 0 },
    promoDiscountPercent: { type: Number, min: 0, max: 100 },
    promoLowestItemDeposit: { type: Number, min: 0 },
    refundKey: { type: String, trim: true },
    sourcePaymentId: { type: String, ref: 'Payment' },
  },
  { timestamps: true }

);

paymentSchema.index({ user: 1, date: -1 });
paymentSchema.index({ reservation: 1 });
paymentSchema.index({ user: 1, checkoutKey: 1 }, {unique: true, partialFilterExpression: {checkoutKey: { $type: 'string' }}});
paymentSchema.index({ stripePaymentIntentId: 1 }, {unique: true, partialFilterExpression: {stripePaymentIntentId: { $type: 'string' }}});
paymentSchema.index({ refundKey: 1 }, {unique: true, partialFilterExpression: {refundKey: { $type: 'string' }}});
export const Payment = mongoose.model("Payment", paymentSchema);