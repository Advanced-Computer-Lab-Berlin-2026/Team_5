import express from "express";
import dns from 'dns';
import cookieParser from "cookie-parser";
import authRoutes from './routes/auth.js';
import lenderItems from './routes/lenderItems.js'
import adminRoutes from './routes/admin.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import { csrfProtection } from './middleware/authSecurity.js';
import wishlistRoutes from './routes/wishlist.js';
import walletRoutes from './routes/wallet.js';
// Define route imports

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

app.use('/api/auth', authRoutes)
app.use('/api/lender/items', lenderItems)
app.use('/api/wishlist', wishlistRoutes)
app.use('/api/wallet', walletRoutes)


// Keep These at the end for fallback errors
app.use(notFound);
app.use(errorHandler);

export default app;
