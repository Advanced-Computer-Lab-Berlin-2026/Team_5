
import mongoose from 'mongoose';

const extensionRequestSchema = new mongoose.Schema(
    {
        reservation: {
            type: String,
            ref: 'Reservation',
            required: true
        },

        originalEndDate: {
            type: Date,
            required: true
        },

        requestedEndDate: {
            type: Date,
            required: true
        },

        status: {
            type: String,
            enum: ['requested', 'accepted', 'rejected'],
            default: 'requested'
        }
    },
    { timestamps: true }
);

// Allow only one outstanding extension request per reservation.
extensionRequestSchema.index(
    { reservation: 1 },
    {
        unique: true,
        partialFilterExpression: { status: 'requested' }
    }
);

export const ExtensionRequest = mongoose.model(
    'ExtensionRequest',
    extensionRequestSchema
);
