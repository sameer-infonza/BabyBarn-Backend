import { PrismaClient } from '@prisma/client';
import { ensurePrismaCheckoutIntent } from './prisma-checkout-intent.js';

const globalForPrisma = globalThis;

function createPrismaClient() {
  return new PrismaClient({
    log: process.env.PRISMA_LOG === 'true' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });
}

/** Singleton Prisma client — avoids connection pool exhaustion under load. */
export let prisma = globalForPrisma.__babybarnPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__babybarnPrisma = prisma;
}

/** Call after migrations/generate so payment routes get a client with CheckoutIntent. */
export function refreshPrismaClientIfNeeded() {
  const next = ensurePrismaCheckoutIntent(prisma);
  if (next !== prisma) {
    prisma = next;
    if (process.env.NODE_ENV !== 'production') {
      globalForPrisma.__babybarnPrisma = prisma;
    }
  }
  return prisma;
}
