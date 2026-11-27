import mongoose from "mongoose";
import crypto from "crypto";
import fileSchema from "./fileSchema.js";

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

    // Policy agreed at booking time.
    cancellationPolicy: {
        freeDays: { type: Number, min: 0 },
        forfeitPercent: { type: Number, min: 0, max: 100 }
    },

    cancelledAt: { type: Date },
    cancelledBy: {
        type: String,
        enum: ['member', 'lender']
    },
    cancelledByUser: { type: String, ref: 'User' },
    cancellationRefundAmount: { type: Number, min: 0 },
    cancellationRefundPaymentId: { type: String, ref: 'Payment' },


    // ---- group: handover
    handover: {
      pickedUpAt: { type: Date },
      returnedAt: { type: Date },
      returnCondition: { type: String, enum: ["good", "damaged"] },
      pickupPhotos: [fileSchema],
      returnPhotos: [fileSchema],
    },

    // ---- group: delivery ----
    delivery: {
      status: { type: String, enum: ["preparing", "out-for-delivery", "delivered"] },
      fee: { type: Number, default: 0, min: 0 },
      address: { type: String },
    },

    // ---- group: payment ----
    payment: {
      depositAmount: { type: Number, required: true, min: 0 }, // already reduced by the membership discount
      discountPercent: { type: Number, default: 0, min: 0, max: 100 }, // SCRUM-495: the membership discount that was applied
      method: { type: String, enum: ["wallet", "card"], required: true },
      // Older direct reservations may have quoted a deposit without collecting it.
      depositCollected: { type: Boolean },
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
reservationSchema.index({ status: 1, startDate: 1, endDate: 1, item: 1 });


// Only approved bookings block dates. Several people can have a pending request for the same dates; once the lender approves one
// (it becomes "upcoming"), those dates are taken. The approve step must therefore re-check for overlaps when it runs.
export const BLOCKING_STATUSES = ["upcoming", "active"];

// Finds a reservation that overlaps the dates.

reservationSchema.statics.findOverlap = function (
    itemId,
    start,
    end,
    session,
    excludeReservationId = null
) {
    const filter = {
        item: itemId,
        status: { $in: BLOCKING_STATUSES },
        startDate: { $lt: end },
        endDate: { $gt: start }
    };

    if (excludeReservationId) {
        filter._id = { $ne: excludeReservationId };
    }

    return this.findOne(filter).session(session || null);
};


export const Reservation = mongoose.model("Reservation", reservationSchema);
