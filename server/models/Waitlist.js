import mongoose from "mongoose";
import crypto from "crypto";

const waitlistSchema = new mongoose.Schema(
  {
    _id: { type: String, default: () => `WTL-${crypto.randomBytes(4).toString("hex")}` },
    item: { type: String, ref: "Item", required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    usernames: [{ type: String, ref: "User" }],
  },
  { timestamps: true }
);

waitlistSchema.index({ item: 1, startDate: 1, endDate: 1 });

export default mongoose.model("Waitlist", waitlistSchema);
