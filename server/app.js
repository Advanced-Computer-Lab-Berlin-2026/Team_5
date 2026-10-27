import express from "express";
import dns from 'dns';
import cookieParser from "cookie-parser";
import authRoutes from './routes/auth.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
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

// Keep These at the end for fallback errors
app.use(notFound);
app.use(errorHandler);

export default app;
