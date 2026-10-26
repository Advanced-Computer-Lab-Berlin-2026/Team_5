import mongoose from "mongoose";

const membershipTierSchema = new mongoose.Schema(
  {
    _id: { type: String }, // = tier name
    tier: { type: String, enum: ["Basic", "Plus", "Premium"], default: "Basic", required: true, unique: true },
    annual_fee: { type: Number, default: 0, min: 0 },
    deposit_discount: { type: Number, default: 0, min: 0, max: 100 }, // %
  },
  { timestamps: true }
);
// use the tier as the _id
membershipTierSchema.pre("validate", function () {
  if (!this._id) this._id = this.tier;
});

export const MembershipTier = mongoose.model("MembershipTier", membershipTierSchema);