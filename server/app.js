import express from "express";

import authRoutes from './routes/auth.js';
// Define route imports

const app = express();

app.use(express.json());

app.get('/api/health', (req, res) =>
  res.status(200).json({ status : "ok" })
);

// Define your routes here

app.use('/api/auth', authRoutes)

// Keep These at the end for fallback errors
app.use( (req, res) =>
  res.status(404).json({ message : "Endpoint not found"})
);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || 'Server Error' });
});

export default app;