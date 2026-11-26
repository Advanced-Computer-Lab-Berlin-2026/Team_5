import mongoose from "mongoose";

const promoCodeSchema = new mongoose.Schema(
  {
    _id: { type: String }, // = code
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    discountPercent: { type: Number, required: true, min: 1, max: 100 },
    minimumDeposit: { type: Number, default: 0, min: 0 },
    active: { type: Boolean, default: true },
    expiresAt: Date,
    maxUses: { type: Number, min: 1 },
  },
  { timestamps: true }
);
// use the code as the _id
promoCodeSchema.pre("validate", function () {
  if (!this._id) this._id = this.code;
});

export const PromoCode = mongoose.model("PromoCode", promoCodeSchema);