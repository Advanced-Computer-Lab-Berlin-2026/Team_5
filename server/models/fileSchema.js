import mongoose from "mongoose";

// One uploaded file (Cloudinary)
const fileSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
  },
  { _id: false }
);

export default fileSchema;