import mongoose from "mongoose";
import crypto from "crypto";

const supportTicketSchema = new mongoose.Schema(
  {
    _id: { type: String, default: () => `TKT-${crypto.randomBytes(4).toString("hex")}` },
    user: { type: String, ref: "User", required: true },
    subject: { type: String, required: true, trim: true },
    status: { type: String, enum: ["in-progress", "resolved"]},
    messages: [
      {
        sender: { type: String, ref: "User", required: true },
        seen: { type: Boolean, default: false },
        text: { type: String, required: true },
        date: { type: Date, default: Date.now },
        userType: { type: String, enum: ["member", "lender", "admin"], required: true },
        _id: false,
      },
    ],
    respondedBy: { type: String, ref: "User" }, // admin username
  },
  { timestamps: true }
);

export const SupportTicket = mongoose.model("SupportTicket", supportTicketSchema);
