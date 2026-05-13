import express, { Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';

import router from './routes/index.route.js';
import { errorMiddleware } from './middleware/error.middleware.js';
import { serializeBigInt } from './utils/helpers.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middlewares ──────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Custom JSON Serializer Middleware ────────────────
// This MUST come before routes to intercept all responses
app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  
  res.json = function(data: any) {
    // Prevent infinite loop if res.json is called recursively
    if ((res as any)._isSerializing) {
      return originalJson(data);
    }
    
    (res as any)._isSerializing = true;
    const serialized = serializeBigInt(data);
    const result = originalJson(serialized);
    (res as any)._isSerializing = false;
    
    return result;
  };
  
  next();
});

import { authMiddleware } from './middleware/auth.middleware.js';

// ─── Health Check ─────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Invoice-to-Payment API running',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// ─── API Authentication Middleware ────────────────────
app.use('/api', authMiddleware);

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
