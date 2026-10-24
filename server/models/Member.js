import mongoose from 'mongoose';

const memberSchema = new mongoose.Schema(
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
        homeAddress: {type: String}
    }
);

memberSchema.index({ username: 1 }, { unique: true });
memberSchema.index({ email: 1 }, { unique: true });

export const Member = mongoose.model('Member', memberSchema);
