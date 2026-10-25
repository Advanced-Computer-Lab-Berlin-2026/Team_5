import express from "express";
import dns from 'dns';
import cookieParser from "cookie-parser";
import authRoutes from './routes/auth.js';
import wishlistRoutes from './routes/wishlist.js';
import walletRoutes from './routes/wallet.js';
// Define route imports

const app = express();

dns.setServers(['8.8.8.8', '1.1.1.1']);

app.use(cookieParser());
app.use(express.json());

app.get('/api/health', (req, res) =>
  res.status(200).json({ status : "ok" })
);

// Define your routes here

app.use('/api/auth', authRoutes)
app.use('/api/wishlist', wishlistRoutes)
app.use('/api/wallet', walletRoutes)

// Keep These at the end for fallback errors
app.use( (req, res) =>
  res.status(404).json({ message : "Endpoint not found"})
);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || 'Server Error' });
});

export default app;
