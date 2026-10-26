import mongoose from "mongoose";
import crypto from "crypto";

const referralSchema = new mongoose.Schema(
  {
    _id: { type: String, default: () => `REF-${crypto.randomBytes(4).toString("hex")}` },
    referrer: { type: String, ref: "User", required: true },
    referred: { type: String, ref: "User", required: true, unique: true },
    status: { type: String, enum: ["sent", "converted"]},
    creditsIssued: { type: Number, default: 0, min: 0 },
    convertedAt: { type: Date },
  },
  { timestamps: true, collection: "referral_links" }
);

export default mongoose.model("Referral", referralSchema);