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

app.use(express.json());
app.use(
  cors({
    origin: config.corsOrigin,
    credentials: true,
  })
);

app.get('/health', (req, res) => {
  res.json({ status: 'OK' });
});

/** Same JSON API for web and mobile; v1 is the stable surface for native apps. */
function mountApi(prefix) {
  app.use(`${prefix}/auth`, authRoutes);
  app.use(`${prefix}/products`, productRoutes);
  app.use(`${prefix}/orders`, orderRoutes);
  app.use(`${prefix}/inventory`, inventoryRoutes);
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
      auth: ['/register', '/login', '/forgot-password', '/reset-password', '/me'],
      products: ['/', '/categories', '/:id'],
      orders: ['/', '/admin/all', '/:id', '/:id/status'],
    },
  });
});

app.use((req, res, next) => {
  next(new AppError(404, 'Route not found'));
});

app.use(errorHandler);

const PORT = config.port;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
