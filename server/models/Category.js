import mongoose from "mongoose";

const categorySchema = new mongoose.Schema(
  {
    _id: { type: String }, // = category name
    name: { type: String, required: true, unique: true, trim: true },
    depositMultiplier: { type: Number, default: 1, min: 1 },
  },
  { timestamps: true }
);
// use the name as the _id
categorySchema.pre("validate", function () {
  if (!this._id) this._id = this.name;
});

export default mongoose.model("Category", categorySchema);