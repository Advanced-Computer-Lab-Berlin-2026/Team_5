import mongoose from "mongoose";
import crypto from "crypto";

const reportSchema = new mongoose.Schema(
  {
    _id: { type: String, default: () => `RPT-${crypto.randomBytes(4).toString("hex")}` },
    reporter: { type: String, ref: "User", required: true },
    targetType: { type: String, enum: ["item", "user"], required: true },
    targetItem: { type: String, ref: "Item" },
    targetUser: { type: String, ref: "User" },
    reason: { type: String, required: true },
    status: { type: String, enum: ["open", "flagged", "removed", "dismissed"], default: "open" },
    reviewedBy: { type: String, ref: "User" }, // admin username
  },
  { timestamps: true }
);

export default mongoose.model("Report", reportSchema);