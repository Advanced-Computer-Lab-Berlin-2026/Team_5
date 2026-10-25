import mongoose from "mongoose";
import { env } from "./env.js";

export async function connectDB() {
    const uri = env.mongoDB;
    try {
        await mongoose.connect(uri, { autoIndex: true });
        console.log('MongoDB connected');
    } catch (err) {
        console.error('MongoDB connection error', err.message);
        process.exit(1);
    }
}