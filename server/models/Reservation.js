import mongoose from "mongoose";
import crypto from "crypto";

const reservationSchema = new mongoose.Schema(
  {
    _id: { type: String, default: () => `RES-${crypto.randomBytes(4).toString("hex")}` }, // reservation id
    item: { type: String, ref: "Item", required: true }, // item id
    borrower: { type: String, ref: "User", required: true }, // username
    lender: { type: String, ref: "User", required: true }, // username

    startDate: { type: Date, required: true },
    endDate: {
      type: Date,
      required: true,
      validate: {
        validator: function (v) {
          return v > this.startDate;
        },
        message: "endDate must be after startDate",
      },
    },

    status: {
      type: String,
      enum: ["pending", "upcoming", "active", "completed", "cancelled", "rejected"],
      default: "pending",
    },

    // ---- group: delivery ----
    delivery: {
      status: { type: String, enum: ["preparing", "out-for-delivery", "delivered"] },
      fee: { type: Number, default: 0, min: 0 },
      address: { type: String },
    },

    // ---- group: payment ----
    payment: {
      depositAmount: { type: Number, required: true, min: 0 },
      method: { type: String, enum: ["wallet", "card"], required: true },
      stripePaymentIntentId: { type: String },
      lateFee: { type: Number, default: 0, min: 0 },
    },

    // ---- group: reviews ----
    reviews: {
      lenderReview: { type: String }, // written by the borrower
      lenderRating: { type: Number, min: 1, max: 5 },
      borrowerReview: { type: String }, // written by the lender
      borrowerRating: { type: Number, min: 1, max: 5 },
    },

    extension: {
      requestedEndDate: Date,
      status: { type: String, enum: ["requested", "accepted", "rejected"] },
    },

    messages: [
      {
        date: { type: Date, default: Date.now },
        seen: { type: Boolean, default: false },
        text: { type: String, required: true },
        sender: { type: String, ref: "User", required: true },
        _id: false,
      },
    ],
  },
  { timestamps: true }
);

reservationSchema.index({ item: 1, startDate: 1, endDate: 1 });
reservationSchema.index({ borrower: 1, status: 1 });
reservationSchema.index({ lender: 1, status: 1 });

export const BLOCKING_STATUSES = ["pending", "upcoming", "active"];

// Finds a reservation that overlaps the dates.
reservationSchema.statics.findOverlap = function (itemId, start, end, session) {
  return this.findOne({
    item: itemId,
    status: { $in: BLOCKING_STATUSES },
    startDate: { $lt: end },
    endDate: { $gt: start },
  }).session(session || null);
};

export const Reservation = mongoose.model("Reservation", reservationSchema);