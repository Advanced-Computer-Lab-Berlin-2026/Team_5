import mongoose from "mongoose";
import crypto from "crypto";

const noticeSchema = new mongoose.Schema(
  {
    _id: { type: String, default: () => `NTC-${crypto.randomBytes(4).toString("hex")}` }, // notice_id
    title: { type: String, required: true, trim: true },
    body: { type: String, required: true },
    postedBy: { type: String, ref: "User", required: true }, // admin username
  },
  { timestamps: true, collection: "community_notices" }
);

export default mongoose.model("Notice", noticeSchema);