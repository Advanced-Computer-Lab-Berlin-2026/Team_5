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
      enum: ["deposit-paid", "deposit-refund", "deposit-forfeit", "late-fee", "membership-fee", "referral-credit"],
      required: true,
    },
    amount: { type: Number, required: true, min: 0 },
    description: { type: String },
    direction: { type: String, enum: ["deduct", "receive"], required: true },
    method: { type: String, enum: ["wallet", "card"], required: true },
    date: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

paymentSchema.index({ user: 1, date: -1 });
paymentSchema.index({ reservation: 1 });

export default mongoose.model("Payment", paymentSchema);