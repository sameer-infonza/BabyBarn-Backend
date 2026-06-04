import dotenv from 'dotenv';

dotenv.config();

const port = parseInt(process.env.PORT || '5000', 10);
const nodeEnv = process.env.NODE_ENV || 'development';

function splitCsv(value) {
  return (value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function toUnique(items) {
  return [...new Set(items)];
}

if (nodeEnv === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is required in production');
}

export const config = {
  database: {
    url: process.env.DATABASE_URL || 'postgresql://localhost/ecommerce',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
    expiryTime: process.env.JWT_EXPIRY || '7d',
    refreshSecret: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || 'your-refresh-secret-change-in-production',
    refreshExpiryTime: process.env.JWT_REFRESH_EXPIRY || '30d',
  },
  port,
  nodeEnv,
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
    ...(nodeEnv === 'production'
      ? []
      : ['http://localhost:3000', 'http://localhost:3001']),
  ]),
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    connectMembership: process.env.STRIPE_CONNECT_ACCOUNT_MEMBERSHIP || '',
    connectStore: process.env.STRIPE_CONNECT_ACCOUNT_STORE || '',
  },
  mail: {
    from: process.env.MAIL_FROM || 'Baby Barn <no-reply@babyburn.local>',
    /** `smtp` | `sendgrid` | `auto` (default: sendgrid if key set, else smtp; dev prefers smtp when both set). */
    provider: (process.env.EMAIL_PROVIDER || 'auto').trim().toLowerCase(),
    /** SendGrid REST API — verified sender must match MAIL_FROM domain. */
    sendgridApiKey: (process.env.SENDGRID_API_KEY || '').trim(),
    /** Optional override for SMTP From (defaults to SMTP_USER display name). */
    smtpFrom: (process.env.MAIL_SMTP_FROM || '').trim(),
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    secure: process.env.SMTP_SECURE === 'true',
  },
  frontend: {
    customerUrl: (process.env.CUSTOMER_FRONTEND_URL || process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, ''),
    adminUrl: (process.env.ADMIN_FRONTEND_URL || 'http://localhost:3001').replace(/\/$/, ''),
  },
  storeUrl: (
    process.env.STORE_PUBLIC_URL ||
    process.env.CUSTOMER_FRONTEND_URL ||
    process.env.FRONTEND_URL ||
    'http://localhost:3000'
  ).replace(/\/$/, ''),
  trustProxy: process.env.TRUST_PROXY === 'true',
  /** Optional base URL for absolute image URLs returned to the client (no trailing slash). */
  publicBaseUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, ''),
  /** Inbound contact form notifications (falls back to SMTP user if unset). */
  contactAdminEmail: (process.env.CONTACT_ADMIN_EMAIL || process.env.ADMIN_EMAIL || '').trim(),
  /** Branding overrides for emails/PDFs (defaults align with packages/brand/brand.tokens.json). */
  brand: {
    supportEmail: (process.env.BRAND_SUPPORT_EMAIL || 'hello@babybarn.co').trim(),
    logoPath: (process.env.BRAND_LOGO_PATH || '/brand/logo-mark.svg').trim(),
  },
  /** Unpaid checkout orders older than this are expired and resources released (minutes). */
  pendingOrderTtlMinutes: parseInt(process.env.PENDING_ORDER_TTL_MINUTES || '60', 10),
  /** When true, approving a STANDARD return restocks one unit to the original SKU. */
  standardReturnRestock: process.env.STANDARD_RETURN_RESTOCK !== 'false',
};
