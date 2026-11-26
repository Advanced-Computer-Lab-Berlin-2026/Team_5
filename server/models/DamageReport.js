import mongoose from "mongoose";
import fileSchema from "./fileSchema.js";
import crypto from "crypto";

const damageReportSchema = new mongoose.Schema(
  {
    _id: { type: String, default: () => `DMG-${crypto.randomBytes(4).toString("hex")}` }, // report id
    reservation: { type: String, ref: "Reservation", required: true },
    type: { type: String, enum: ["report", "decision", "dispute", "resolution"], required: true },
    returnCondition: { type: String },
    depositForfeit: { type: Number, min: 0 }, // set on a decision and on a resolution
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
// one step of each type per reservation: stops double clicks (and two readers at once) creating duplicate steps
damageReportSchema.index({ reservation: 1, type: 1 }, { unique: true });

export const DamageReport = mongoose.model("DamageReport", damageReportSchema);