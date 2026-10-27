import mongoose from "mongoose";
import crypto from "crypto";

const friendLinkSchema = new mongoose.Schema(
  {
    _id: { type: String, default: () => `LNK-${crypto.randomBytes(4).toString("hex")}` },
    requester: { type: String, ref: "User", required: true },
    recipient: { type: String, ref: "User", required: true },
    relation: { type: String, enum: ["spouse", "parent", "child", "siblings"], required: true },
    status: { type: String, enum: ["pending", "accepted", "rejected"] },
  },
  { timestamps: true, collection: "friend_links" }
);

friendLinkSchema.index({ requester: 1, recipient: 1 }, { unique: true });

export const FriendLink = mongoose.model("FriendLink", friendLinkSchema);