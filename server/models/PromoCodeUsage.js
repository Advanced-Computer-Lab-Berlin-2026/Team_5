import mongoose from "mongoose";
import crypto from "crypto";

const promoCodeUsageSchema = new mongoose.Schema(
  {
    _id: { type: String, default: () => `PCU-${crypto.randomBytes(4).toString("hex")}` },
    transaction: { type: String, ref: "Payment", required: true }, // transaction id
    code: { type: String, ref: "PromoCode", required: true },
    user: { type: String, ref: "User", required: true },
    reservation: { type: String, ref: "Reservation", required: true },
    date: { type: Date, default: Date.now },
  },
  { timestamps: true, collection: "promocode_usage" }
);

promoCodeUsageSchema.index({ code: 1, user: 1 });

export const PromoCodeUsage = mongoose.model("PromoCodeUsage", promoCodeUsageSchema);