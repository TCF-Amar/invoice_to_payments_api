import express, { Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';

import router from './routes/index.js';
import { errorMiddleware } from './middleware/error.middleware.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Custom JSON Replacer for BigInt and Decimal ─────
const jsonReplacer = (key: string, value: any) => {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  
  // Handle Prisma Decimal type
  if (value && typeof value === 'object' && value.constructor && value.constructor.name === 'Decimal') {
    return parseFloat(value.toString());
  }
  
  return value;
};

// Override JSON.stringify to handle BigInt
const originalJson = (Response.prototype as any).json;
(Response.prototype as any).json = function(body: any) {
  const jsonString = JSON.stringify(body, jsonReplacer);
  this.set('Content-Type', 'application/json');
  return this.send(jsonString);
};

// ─── Middlewares ──────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Health Check ─────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Invoice-to-Payment API running',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// ─── API Routes ───────────────────────────────────────
app.use('/api/v1', router);

// ─── 404 Handler ──────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`
  });
});

// ─── Error Handler ────────────────────────────────────
app.use(errorMiddleware);

// ─── Start Server ─────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════╗
  ║  Invoice-to-Payment API               ║
  ║  Running on: http://localhost:${PORT}    ║
  ║  Environment: ${process.env.NODE_ENV || 'development'}         ║
  ╚═══════════════════════════════════════╝
  `);
});

server.on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Error: Port ${PORT} is already in use.`);
    console.error(`   Try killing the process on port ${PORT} or use a different port (e.g., set PORT=3001).\n`);
  } else {
    console.error('\n❌ Server error:', err, '\n');
  }
  process.exit(1);
});

export default app;
