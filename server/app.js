import express from "express";
import dns from 'dns';
import cookieParser from "cookie-parser";
import authRoutes from './routes/auth.js';
import itemRoutes from './routes/items.js';
import categoryRoutes from './routes/categories.js';
import adminRoutes from './routes/admin.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import { csrfProtection } from './middleware/authSecurity.js';
import wishlistRoutes from './routes/wishlist.js';
import walletRoutes from './routes/wallet.js';
import noticeRoutes from './routes/notices.js';
import profileRoutes from './routes/profile.js';
import householdRoutes from './routes/household.js';
// Define route imports
import lenderRequestRoutes from './routes/lenderRequestRoutes.js';
import adminLenderRequestRoutes from './routes/adminLenderRequestRoutes.js';

const app = express();

dns.setServers(['8.8.8.8', '1.1.1.1']);

app.use(cookieParser());
// Covers current and future API routers before they can process a mutation.
app.use('/api', csrfProtection);
app.use(express.json());


app.get('/api/health', (req, res) =>
  res.status(200).json({ status : "ok" })
);


app.use('/api/admin', adminRoutes);
// Define your routes here
app.use('/api/lender-requests', lenderRequestRoutes);
app.use('/api/admin/lender-requests', adminLenderRequestRoutes);

app.use('/api/auth', authRoutes)
app.use('/api/items', itemRoutes)
app.use('/api/categories', categoryRoutes)
app.use('/api/wishlist', wishlistRoutes)
app.use('/api/wallet', walletRoutes)
app.use('/api/notices', noticeRoutes)
app.use('/api/profile', profileRoutes)
app.use('/api/household', householdRoutes)

// Keep These at the end for fallback errors
app.use(notFound);
app.use(errorHandler);


export default app;
