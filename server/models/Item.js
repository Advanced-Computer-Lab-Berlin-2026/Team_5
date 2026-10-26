import mongoose from "mongoose";
import fileSchema from "./fileSchema.js";
import crypto from "crypto";

const itemSchema = new mongoose.Schema(
  {
    _id: { type: String, default: () => `ITM-${crypto.randomBytes(4).toString("hex")}` }, // item id
    name: { type: String, required: true, trim: true },
    category: { type: String, ref: "Category", required: true },
    description: { type: String, required: true },
    photos: [fileSchema],
    conditionNotes: [{ type: String }],
    depositAmount: { type: Number, required: true, min: 0 },
    archived: { type: Boolean, default: false },
    owner: { type: String, ref: "User", required: true }, // username
    flagged: { type: Boolean, default: false },

    borrowingRules: {
      maxDurationDays: { type: Number, min: 1 },
      minTrustScore: { type: Number, default: 0, min: 0, max: 100 },
      custom: [{ type: String }],
    },

    documents: [fileSchema], // manual / instructions

    // ---- group: pickup ----
    pickup: {
      location: { type: String, required: true },
      instructions: { type: String },
    },

    // ---- group: delivery ----
    delivery: {
      offered: { type: Boolean, default: false },
      fee: { type: Number, default: 0, min: 0 },
      details: { type: String },
    },

    // ---- group: cancellation ----
    cancellation: {
      freeDays: { type: Number, default: 0, min: 0 },
      forfeitPercent: { type: Number, default: 0, min: 0, max: 100 }, // after the free window
    },

    attributes: [{ key: String, value: String, _id: false }],
  },
  { timestamps: true }
);

itemSchema.index({ name: "text" });
itemSchema.index({ category: 1, archived: 1 });
itemSchema.index({ owner: 1 });

export default mongoose.model("Item", itemSchema);