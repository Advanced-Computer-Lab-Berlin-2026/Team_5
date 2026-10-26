import mongoose from "mongoose";
import fileSchema from "./fileSchema.js";
import crypto from "crypto";

const damageReportSchema = new mongoose.Schema(
  {
    _id: { type: String, default: () => `DMG-${crypto.randomBytes(4).toString("hex")}` }, // report id
    reservation: { type: String, ref: "Reservation", required: true },
    type: { type: String, enum: ["report", "dispute", "resolution"], required: true },
    returnCondition: { type: String },
    depositForfeit: { type: Number, min: 0 }, // optional, set in the final verdict
    report: {
      photos: [fileSchema],
      message: { type: String },
      date: { type: Date, default: Date.now },
    },
    pdfLink: { type: String },
  },
  { timestamps: true, collection: "damage_reports" }
);

damageReportSchema.index({ reservation: 1, createdAt: 1 });

export const DamageReport = mongoose.model("DamageReport", damageReportSchema);