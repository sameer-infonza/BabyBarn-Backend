import { config } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import {
  createJobOwnerId,
  runWithJobLease,
} from '../lib/job-lease.js';
import { orderService } from './order.service.js';
import { returnsService } from './returns.service.js';
import {
  sendAccessRenewalReminders,
  sendAccessExpiredNotices,
} from './membership.service.js';

/**
 * SCALE-002 job registry.
 * Each job keeps its prior interval and calls the same domain services;
 * only ownership is coordinated via JobLease.
 */
export const SCHEDULED_JOBS = Object.freeze([
  {
    key: 'ups-tracking-sync',
    intervalMs: 15 * 60 * 1000,
    leaseMs: 10 * 60 * 1000,
    run: () => orderService.syncUpsTrackingBatch(),
  },
  {
    key: 'return-tracking-sync',
    intervalMs: 15 * 60 * 1000,
    leaseMs: 10 * 60 * 1000,
    run: () => returnsService.syncReturnTrackingBatch(),
  },
  {
    key: 'access-renewal-reminders',
    intervalMs: 24 * 60 * 60 * 1000,
    leaseMs: 30 * 60 * 1000,
    initialDelayMs: 60 * 1000,
    run: () => sendAccessRenewalReminders(),
  },
  {
    key: 'access-expired-notices',
    intervalMs: 24 * 60 * 60 * 1000,
    leaseMs: 30 * 60 * 1000,
    initialDelayMs: 60 * 1000,
    run: () => sendAccessExpiredNotices(),
  },
  {
    key: 'expire-pending-orders',
    intervalMs: 15 * 60 * 1000,
    leaseMs: 10 * 60 * 1000,
    run: () => orderService.expireStalePendingOrders(),
  },
  {
    key: 'expire-checkout-intents',
    intervalMs: 15 * 60 * 1000,
    leaseMs: 10 * 60 * 1000,
    run: async () => {
      const { checkoutIntentService } = await import('./checkout-intent.service.js');
      return checkoutIntentService.expireStaleCheckoutIntents();
    },
  },
  {
    key: 'back-in-stock-alerts',
    intervalMs: 6 * 60 * 60 * 1000,
    leaseMs: 30 * 60 * 1000,
    run: async () => {
      const { sendBackInStockAlerts } = await import('./engagement-jobs.service.js');
      return sendBackInStockAlerts();
    },
  },
  {
    key: 'wishlist-price-drop-alerts',
    intervalMs: 6 * 60 * 60 * 1000,
    leaseMs: 30 * 60 * 1000,
    run: async () => {
      const { sendWishlistPriceDropAlerts } = await import('./engagement-jobs.service.js');
      return sendWishlistPriceDropAlerts();
    },
  },
  {
    key: 'guest-data-retention-purge',
    intervalMs: 24 * 60 * 60 * 1000,
    leaseMs: 30 * 60 * 1000,
    initialDelayMs: 90 * 1000,
    run: async () => {
      const { purgeExpiredGuestData } = await import('./guest-retention.service.js');
      return purgeExpiredGuestData();
    },
  },
]);

/**
 * Run a single registered job under a distributed lease.
 * @returns {Promise<{ ran: boolean, reason?: string, result?: unknown }>}
 */
export async function runScheduledJob(jobKey, {
  db = prisma,
  ownerId = createJobOwnerId(),
  jobs = SCHEDULED_JOBS,
} = {}) {
  const def = jobs.find((j) => j.key === jobKey);
  if (!def) {
    throw new Error(`Unknown scheduled job: ${jobKey}`);
  }

  return runWithJobLease(
    db,
    { jobKey: def.key, ownerId, leaseMs: def.leaseMs },
    () => def.run()
  );
}

/**
 * Start in-process timers that claim leases before executing domain jobs.
 * Safe across N API instances; disable via BACKGROUND_JOBS_ENABLED=false.
 */
export function startScheduledJobs({
  db = prisma,
  enabled = config.backgroundJobsEnabled,
  ownerId = createJobOwnerId(),
  jobs = SCHEDULED_JOBS,
  logger = console,
} = {}) {
  if (!enabled) {
    logger.log?.('[jobs] background jobs disabled (BACKGROUND_JOBS_ENABLED=false)');
    return { stop() {}, ownerId, enabled: false };
  }

  const timers = [];

  const tick = (def) => {
    runScheduledJob(def.key, { db, ownerId, jobs }).then(
      (outcome) => {
        if (!outcome.ran) {
          logger.debug?.(`[jobs] ${def.key} skipped (${outcome.reason})`);
        }
      },
      (err) => {
        logger.error?.(`[jobs] ${def.key} failed`, err);
      }
    );
  };

  for (const def of jobs) {
    if (def.initialDelayMs != null) {
      const t = setTimeout(() => tick(def), def.initialDelayMs);
      if (typeof t.unref === 'function') t.unref();
      timers.push(t);
    }
    const interval = setInterval(() => tick(def), def.intervalMs);
    if (typeof interval.unref === 'function') interval.unref();
    timers.push(interval);
  }

  logger.log?.(`[jobs] scheduled ${jobs.length} leased jobs (owner=${ownerId})`);

  return {
    enabled: true,
    ownerId,
    stop() {
      for (const t of timers) {
        clearTimeout(t);
        clearInterval(t);
      }
    },
  };
}
