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

reportSchema.pre('validate', function () {
  const hasItem = Boolean(this.targetItem);
  const hasUser = Boolean(this.targetUser);
  if (this.targetType === 'item' && (!hasItem || hasUser)) {
    this.invalidate('targetItem', 'Item reports must reference exactly one item');
  }
  if (this.targetType === 'user' && (!hasUser || hasItem)) {
    this.invalidate('targetUser', 'User reports must reference exactly one user');
  }
});

export const Report = mongoose.model("Report", reportSchema);