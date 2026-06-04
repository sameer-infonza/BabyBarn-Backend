import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config/env.js';
import { prisma, refreshPrismaClientIfNeeded } from './lib/prisma.js';
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
import wishlistRoutes from './routes/wishlist.js';
import stockAlertsRoutes from './routes/stock-alerts.js';
import { stripeWebhook } from './controllers/payment.controller.js';
import { sendAccessRenewalReminders, sendAccessExpiredNotices } from './services/membership.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

ensureUploadDirs();

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

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

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many auth attempts. Try again later.' },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Try again later.' },
});

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

app.use('/api/auth', authLimiter);
app.use('/api/v1/auth', authLimiter);
app.use('/api', apiLimiter);
app.use('/api/v1', apiLimiter);

/** Log every API request + response status to the terminal (dev-friendly). */
app.use((req, res, next) => {
  const started = Date.now();
  const path = req.originalUrl || req.url;
  if (!path.startsWith('/api') && !path.startsWith('/health')) {
    next();
    return;
  }
  // Ignore unrelated browser/extension probes (e.g. socket.io from other tabs).
  if (path.startsWith('/socket.io')) {
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

app.get('/health/live', (req, res) => {
  res.json({ status: 'OK' });
});

app.get('/health/ready', async (req, res, next) => {
  try {
    const db = refreshPrismaClientIfNeeded();
    await db.$queryRaw`SELECT 1`;
    await db.$queryRaw`SELECT 1 FROM "CheckoutIntent" LIMIT 1`;
    res.json({ status: 'OK', db: 'connected', checkoutIntent: true });
  } catch (error) {
    if (error?.code === 'PRISMA_CHECKOUT_INTENT_MISSING') {
      return next(error);
    }
    if (error?.code === 'P2021' || /CheckoutIntent/i.test(String(error?.message || ''))) {
      return next(
        new AppError(
          503,
          'Database migration required: run `npx prisma migrate deploy` in backend/',
          'CHECKOUT_INTENT_TABLE_MISSING'
        )
      );
    }
    next(new AppError(503, 'Database unavailable', 'DB_UNAVAILABLE'));
  }
});

app.get('/health', (req, res) => {
  res.redirect(307, '/health/live');
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
    health: '/health/live',
  });
});

app.get('/api/v1', (req, res) => {
  res.json({
    name: 'Baby Barn API',
    version: '1',
    health: '/health/live',
    routes: {
      public: ['/business-settings'],
      membership: ['/registration', '/payments/history', '/savings'],
      auth: [
        '/register',
        '/login',
        '/refresh-token',
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

try {
  refreshPrismaClientIfNeeded();
} catch (err) {
  console.error('[startup] Prisma client is missing CheckoutIntent support:', err?.message || err);
  console.error('  Run: cd backend && npx prisma migrate deploy && npx prisma generate');
  console.error('  Then restart this server.');
  process.exit(1);
}

app.listen(PORT, () => {
  console.log('');
  console.log('══════════════════════════════════════════════');
  console.log(`  Baby Barn API listening on http://localhost:${PORT}`);
  console.log(`  Health check: http://localhost:${PORT}/health/live`);
  console.log(`  API base:     http://localhost:${PORT}/api`);
  console.log(`  Environment:  ${config.nodeEnv}`);
  console.log('══════════════════════════════════════════════');
  console.log('');

  setInterval(() => {
    orderService.syncUpsTrackingBatch().catch((err) => {
      console.error('[jobs] UPS tracking sync failed', err);
    });
  }, 15 * 60 * 1000);

  const renewalReminderMs = 24 * 60 * 60 * 1000;
  setInterval(() => {
    sendAccessRenewalReminders().catch((err) => {
      console.error('[jobs] ACCESS renewal reminder failed', err);
    });
    sendAccessExpiredNotices().catch((err) => {
      console.error('[jobs] ACCESS expired notice failed', err);
    });
  }, renewalReminderMs);
  setTimeout(() => {
    sendAccessRenewalReminders().catch((err) => {
      console.error('[jobs] ACCESS renewal reminder (initial) failed', err);
    });
    sendAccessExpiredNotices().catch((err) => {
      console.error('[jobs] ACCESS expired notice (initial) failed', err);
    });
  }, 60 * 1000);

  const pendingOrderCleanupMs = 15 * 60 * 1000;
  setInterval(() => {
    orderService.expireStalePendingOrders().catch((err) => {
      console.error('[jobs] pending order cleanup failed', err);
    });
    import('./services/checkout-intent.service.js').then(({ checkoutIntentService }) =>
      checkoutIntentService.expireStaleCheckoutIntents().catch((err) => {
        console.error('[jobs] checkout intent cleanup failed', err);
      })
    );
  }, pendingOrderCleanupMs);

  const engagementMs = 6 * 60 * 60 * 1000;
  setInterval(() => {
    import('./services/engagement-jobs.service.js').then(({ sendBackInStockAlerts, sendWishlistPriceDropAlerts }) => {
      sendBackInStockAlerts().catch((err) => {
        console.error('[jobs] back-in-stock alerts failed', err);
      });
      sendWishlistPriceDropAlerts().catch((err) => {
        console.error('[jobs] price-drop alerts failed', err);
      });
    });
  }, engagementMs);
});

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  process.exit(1);
});
