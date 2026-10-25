import mongoose from 'mongoose';

const passwordResetSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },
    codeHash: { type: String, required: true },
    resetTokenHash: { type: String },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0, min: 0 }
}, { timestamps: true });

passwordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const PasswordReset = mongoose.model('PasswordReset', passwordResetSchema);
