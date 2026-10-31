import mongoose from 'mongoose';
import dns from 'node:dns/promises';
import { connectDB } from '../config/db.js';
import { User } from '../models/User.js';

dns.setServers(['1.1.1.1', '8.8.8.8']);

try {
    await connectDB();

    const indexes = await User.listSearchIndexes();

    for (const index of indexes) {
        console.log({
            name: index.name,
            status: index.status,
            queryable: index.queryable
        });
    }

} catch (error) {
    console.error('Error checking Search indexes:', error);
    process.exitCode = 1;
} finally {
    await mongoose.disconnect();
}