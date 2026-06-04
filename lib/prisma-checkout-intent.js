import { PrismaClient } from '@prisma/client';
import { AppError } from '../utils/error-handler.js';

const globalForPrisma = globalThis;

function createPrismaClient() {
  return new PrismaClient({
    log: process.env.PRISMA_LOG === 'true' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });
}

function clientHasCheckoutIntent(client) {
  return typeof client?.checkoutIntent?.findMany === 'function';
}

/**
 * After `prisma migrate` / `prisma generate`, a still-running API process may keep an old
 * PrismaClient without CheckoutIntent. Reconnect in development; fail clearly in production.
 */
export function ensurePrismaCheckoutIntent(prisma) {
  if (clientHasCheckoutIntent(prisma)) {
    return prisma;
  }

  if (process.env.NODE_ENV !== 'production') {
    const previous = globalForPrisma.__babybarnPrisma;
    if (previous?.$disconnect) {
      void previous.$disconnect().catch(() => {});
    }
    delete globalForPrisma.__babybarnPrisma;
    const fresh = createPrismaClient();
    globalForPrisma.__babybarnPrisma = fresh;
    if (clientHasCheckoutIntent(fresh)) {
      return fresh;
    }
  }

  throw new AppError(
    503,
    'Checkout is temporarily unavailable. Stop the API server, run `npx prisma migrate deploy` and `npx prisma generate` in the backend folder, then restart the server.',
    'PRISMA_CHECKOUT_INTENT_MISSING'
  );
}
