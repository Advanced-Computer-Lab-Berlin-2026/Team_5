import mongoose from "mongoose";
import crypto from "crypto";

const waitlistSchema = new mongoose.Schema(
  {
    _id: { type: String, default: () => `WTL-${crypto.randomBytes(4).toString("hex")}` },
    item: { type: String, ref: "Item", required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    username: { type: String, ref: "User", required: true },
    promotedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

waitlistSchema.index({ item: 1, startDate: 1, endDate: 1, username: 1 }, { unique: true });
waitlistSchema.index({ item: 1, promotedAt: 1, startDate: 1 });
waitlistSchema.index({ startDate: 1, endDate: 1, item: 1 });

export const Waitlist = mongoose.model("Waitlist", waitlistSchema);
