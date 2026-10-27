import mongoose from "mongoose";
import crypto from "crypto";
import fileSchema from "./fileSchema.js";


const userSchema = new mongoose.Schema(
  {
    // ---- top level: login, role, money, links ----
    _id: { type: String }, // = username
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true }, // already a bcrypt hash
    role: { type: String, enum: ["member", "lender", "admin"], default: "member" },
    trustScore: { type: Number, default: 50, min: 0, max: 100 },
    wallet: { type: Number, default: 0, min: 0 }, // in Martinies ₥ :p
    suspended: { type: Boolean, default: false },

    // ---- group: profile ----
    profile: {
      name: { type: String, required: true },
      email: { type: String, required: true, unique: true },
      phone: { type: String, default: "" },
      address: { type: String, default: "" },
    },

    // ---- group: verified-lender request ----
    verification: {
      status: {
        type: String,
        enum: ["none", "pending", "accepted", "rejected", "retry"],
        default: "none",
      },
      note: { type: String },
      documents: [
        {
          type: { type: String, enum: ["id", "addressProof", "both"], required: true },
          file: { type: fileSchema, required: true },
          _id: false,
        },
      ],
    },

    // ---- group: membership ----
    membership: {
      tier: { type: String, ref: "MembershipTier", default: "Basic" },
      startDate: { type: Date, default: Date.now },
    },

    // ---- lists and links ----
    wishlist: [{ type: String, ref: "Item" }],
    borrow_list: [
      {
        item: { type: String, ref: "Item", required: true },
        startDate: { type: Date, required: true },
        endDate: { type: Date, required: true },
        _id: false,
      },
    ],
    referral_code: { type: String, unique: true, sparse: true },
    referredBy: { type: String, ref: "User" },
  },
  { timestamps: true }
);

// use the username as the _id
userSchema.pre("validate", function () {
  if (!this._id) this._id = this.username;
});

// make a referral code if there is none
userSchema.pre("validate", function () {
  if (!this.referral_code && this.username) {
    const base = this.username.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 8);
    this.referral_code = `${base}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
  }
});

// to never send the hash to the browser by accident
userSchema.set("toJSON", {
  transform: (_doc, ret) => {
    delete ret.password;
    return ret;
  },
});

export const User = mongoose.model("User", userSchema);
