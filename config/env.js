import dotenv from 'dotenv';

dotenv.config();

const port = parseInt(process.env.PORT || '5000', 10);

function splitCsv(value) {
  return (value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function toUnique(items) {
  return [...new Set(items)];
}

export const config = {
  database: {
    url: process.env.DATABASE_URL || 'postgresql://localhost/ecommerce',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
    expiryTime: process.env.JWT_EXPIRY || '7d',
  },
  port,
  nodeEnv: process.env.NODE_ENV || 'development',
  /**
   * CORS:
   * - CORS_ORIGIN can hold a full comma-separated allowlist.
   * - FRONTEND_USER_URLS / FRONTEND_ADMIN_URLS support split config by app.
   * - Dev defaults ensure local admin + customer apps work out of the box.
   */
  corsOrigins: toUnique([
    ...splitCsv(process.env.CORS_ORIGIN),
    ...splitCsv(process.env.FRONTEND_USER_URLS),
    ...splitCsv(process.env.FRONTEND_ADMIN_URLS),
    ...(process.env.NODE_ENV === 'production'
      ? []
      : ['http://localhost:3000', 'http://localhost:3001']),
  ]),
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    connectMembership: process.env.STRIPE_CONNECT_ACCOUNT_MEMBERSHIP || '',
    connectStore: process.env.STRIPE_CONNECT_ACCOUNT_STORE || '',
  },
  storeUrl: (process.env.STORE_PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, ''),
  trustProxy: process.env.TRUST_PROXY === 'true',
  /** Base URL for absolute image URLs returned to the client (no trailing slash). */
  publicBaseUrl: (process.env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/$/, ''),
};
