import dotenv from 'dotenv';

dotenv.config();

const port = parseInt(process.env.PORT || '5000', 10);

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
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  trustProxy: process.env.TRUST_PROXY === 'true',
  /** Base URL for absolute image URLs returned to the client (no trailing slash). */
  publicBaseUrl: (process.env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/$/, ''),
};
