import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema(
    {
        username: {
            type: String,
            required: true
        },
        name: {
            type: String,
            required: true
        },
        email: {
            type: String,
            required: true
        },
        password: {
            type: String,
            required: true
        },
        phoneNumber: {type: String},
        homeAddress: {type: String},
        role: {
            type: String,
            enum: ['admin', 'member', 'lender'],  
            default: 'member'  
        },
        suspended: {
            type: Boolean,
            default: false
        }
    }
);

UserSchema.index({ username: 1 }, { unique: true });
UserSchema.index({ email: 1 }, { unique: true });

export const User = mongoose.model('User', UserSchema);
