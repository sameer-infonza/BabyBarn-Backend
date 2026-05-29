import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config/env.js';
import { errorHandler, AppError } from './utils/error-handler.js';
import { ensureUploadDirs } from './utils/product-upload.js';
import authRoutes from './routes/auth.js';
import productRoutes from './routes/products.js';
import orderRoutes from './routes/orders.js';
import inventoryRoutes from './routes/inventory.js';
import paymentRoutes from './routes/payments.js';
import contactRoutes from './routes/contact.js';
import returnsRoutes from './routes/returns.js';
import walletRoutes from './routes/wallet.js';
import adminRoutes from './routes/admin.js';
import { orderService } from './services/order.service.js';
import shippingRoutes from './routes/shipping.js';
import publicRoutes from './routes/public.js';
import membershipRoutes from './routes/membership.js';
import { stripeWebhook } from './controllers/payment.controller.js';
import { sendAccessRenewalReminders } from './services/membership.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

ensureUploadDirs();
app.use(
  '/uploads',
  express.static(path.join(__dirname, 'uploads'), {
    maxAge: config.nodeEnv === 'production' ? '7d' : 0,
  })
);

if (config.trustProxy) {
  app.set('trust proxy', 1);
}

app.use(
  cors({
    origin(origin, callback) {
      // Allow non-browser or same-origin server requests with no Origin header.
      if (!origin) {
        callback(null, true);
        return;
      }

      if (config.corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new AppError(403, `CORS origin rejected: ${origin}`));
    },
    credentials: true,
    optionsSuccessStatus: 204,
  })
);

app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), (req, res, next) =>
  stripeWebhook(req, res).catch(next)
);

app.use(
  express.json({
    verify(req, res, buf) {
      void res;
      req.rawBody = Buffer.from(buf);
    },
  })
);

/** Log every API request + response status to the terminal (dev-friendly). */
app.use((req, res, next) => {
  const started = Date.now();
  const path = req.originalUrl || req.url;
  if (!path.startsWith('/api') && path !== '/health') {
    next();
    return;
  }
  res.on('finish', () => {
    const ms = Date.now() - started;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'log';
    const tag = res.statusCode >= 500 ? 'ERR' : res.statusCode >= 400 ? 'WARN' : 'OK';
    console[level](`[${tag}] ${req.method} ${path} → ${res.statusCode} (${ms}ms)`);
  });
  next();
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK' });
});

/** Same JSON API for web and mobile; v1 is the stable surface for native apps. */
function mountApi(prefix) {
  app.use(`${prefix}/auth`, authRoutes);
  app.use(`${prefix}/products`, productRoutes);
  app.use(`${prefix}/orders`, orderRoutes);
  app.use(`${prefix}/inventory`, inventoryRoutes);
  app.use(`${prefix}/payments`, paymentRoutes);
  app.use(`${prefix}/contact`, contactRoutes);
  app.use(`${prefix}/returns`, returnsRoutes);
  app.use(`${prefix}/wallet`, walletRoutes);
  app.use(`${prefix}/admin`, adminRoutes);
  app.use(`${prefix}/shipping`, shippingRoutes);
  app.use(`${prefix}/public`, publicRoutes);
  app.use(`${prefix}/membership`, membershipRoutes);
}

mountApi('/api');
mountApi('/api/v1');

app.get('/api', (req, res) => {
  res.json({
    name: 'Baby Barn API',
    version: '1',
    docs: 'Use /api/v1/* for mobile clients; /api/* is an alias.',
    prefixes: ['/api', '/api/v1'],
    health: '/health',
  });
});

app.get('/api/v1', (req, res) => {
  res.json({
    name: 'Baby Barn API',
    version: '1',
    health: '/health',
    routes: {
      public: ['/business-settings'],
      membership: ['/registration', '/payments/history', '/savings'],
      auth: [
        '/register',
        '/login',
        '/forgot-password',
        '/reset-password',
        '/verify-email',
        '/resend-verification',
        '/me',
        '/change-password',
        '/addresses',
        '/addresses/:addressId',
      ],
      products: ['/', '/categories', '/:slugOrPublicId'],
      orders: ['/', '/admin/all', '/:id', '/:id/status'],
      payments: ['/checkout/membership'],
    },
  });
});

app.use((req, res, next) => {
  next(new AppError(404, 'Route not found'));
});

app.use(errorHandler);

const PORT = config.port;
app.listen(PORT, () => {
  console.log('');
  console.log('══════════════════════════════════════════════');
  console.log(`  Baby Barn API listening on http://localhost:${PORT}`);
  console.log(`  Health check: http://localhost:${PORT}/health`);
  console.log(`  API base:     http://localhost:${PORT}/api`);
  console.log(`  Environment:  ${config.nodeEnv}`);
  console.log('══════════════════════════════════════════════');
  console.log('');
  setInterval(() => {
    orderService.syncUpsTrackingBatch().catch(() => {});
  }, 15 * 60 * 1000);

  const renewalReminderMs = 24 * 60 * 60 * 1000;
  setInterval(() => {
    sendAccessRenewalReminders().catch((err) => {
      console.error('[membership] renewal reminder job failed', err);
    });
  }, renewalReminderMs);
  setTimeout(() => {
    sendAccessRenewalReminders().catch(() => {});
  }, 60 * 1000);
});

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  process.exit(1);
});
