import mongoose from "mongoose";
import crypto from "crypto";

const notificationSchema = new mongoose.Schema(
  {
    _id: { type: String, default: () => `NOT-${crypto.randomBytes(4).toString("hex")}` },
    username: { type: String, ref: "User", required: true },
    reservation: { type: String, ref: "Reservation" }, // optional
    type: {
      type: String,
      enum: [
        "delivery",
        "accepted",
        "rejected",
        "upcoming-return-date",
        "favourite-available",
        "renewal-reminder",
        "waitlist-available",
        "community-notice",
        "other",
      ],
      default: "other",
    },
    read: { type: Boolean, default: false },
    message: { type: String, required: true },
  },
  { timestamps: true }
);

notificationSchema.index({ username: 1, read: 1, createdAt: -1 });

export default mongoose.model("Notification", notificationSchema);