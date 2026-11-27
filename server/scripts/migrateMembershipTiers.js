import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { MembershipTier } from '../models/MembershipTier.js';

try {
    await connectDB();
    const corrections = [
        { tier: 'Plus', field: 'annual_fee', previous: 300, corrected: 150 },
        { tier: 'Premium', field: 'annual_fee', previous: 800, corrected: 300 },
        { tier: 'Premium', field: 'deposit_discount', previous: 25, corrected: 20 }
    ];
    for (const { tier, field, previous, corrected } of corrections) {
        const result = await MembershipTier.updateOne(
            { tier, [field]: previous },
            { $set: { [field]: corrected } }
        );
        console.log(tier, field, result.modifiedCount ? 'corrected' : 'no legacy value found');
    }
} catch (error) {
    console.error('Membership tier migration failed:', error.message);
    process.exitCode = 1;
} finally {
    await mongoose.disconnect();
}
