import os from 'os';
import { randomBytes } from 'crypto';

/**
 * SCALE-002: PostgreSQL-backed job leases for multi-instance-safe scheduled work.
 *
 * Uses an atomic INSERT … ON CONFLICT … WHERE lease expired (or same owner)
 * so Prisma connection pooling cannot break coordination the way session
 * advisory locks would.
 */

export const JOB_LEASE_STATUS = Object.freeze({
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
});

/** Stable-ish owner id for this process (hostname:pid:nonce). */
export function createJobOwnerId(prefix = 'api') {
  return `${prefix}:${os.hostname()}:${process.pid}:${randomBytes(4).toString('hex')}`;
}

/**
 * Pure claim decision used by in-memory tests and mirrored by SQL.
 * @returns {{ acquired: true, row } | { acquired: false, reason: 'lock_held' }}
 */
export function decideLeaseClaim(existing, { jobKey, ownerId, leaseMs, now = Date.now() }) {
  const expiresAt = new Date(now + leaseMs);
  if (
    !existing ||
    existing.leaseExpiresAt.getTime() <= now ||
    existing.ownerId === ownerId
  ) {
    return {
      acquired: true,
      row: {
        jobKey,
        ownerId,
        leaseExpiresAt: expiresAt,
        lastStartedAt: new Date(now),
        lastFinishedAt: existing?.lastFinishedAt ?? null,
        lastStatus: null,
        lastError: null,
      },
    };
  }
  return { acquired: false, reason: 'lock_held' };
}

/**
 * In-memory lease store mirroring SQL claim / renew / release semantics.
 * Used by SCALE-002 unit tests (no DB required).
 */
export function createMemoryJobLeaseStore(initial = new Map()) {
  const store = initial instanceof Map ? initial : new Map(Object.entries(initial));

  return {
    _store: store,
    async tryAcquire({ jobKey, ownerId, leaseMs, now = Date.now() }) {
      const decision = decideLeaseClaim(store.get(jobKey) ?? null, {
        jobKey,
        ownerId,
        leaseMs,
        now,
      });
      if (!decision.acquired) return null;
      const prev = store.get(jobKey);
      const row = {
        ...decision.row,
        lastFinishedAt: prev?.lastFinishedAt ?? null,
        updatedAt: new Date(now),
      };
      store.set(jobKey, row);
      return { ...row };
    },
    async renew({ jobKey, ownerId, leaseMs, now = Date.now() }) {
      const row = store.get(jobKey);
      if (!row || row.ownerId !== ownerId || row.leaseExpiresAt.getTime() <= now) {
        return null;
      }
      row.leaseExpiresAt = new Date(now + leaseMs);
      row.updatedAt = new Date(now);
      return { ...row };
    },
    async release({ jobKey, ownerId, status, error = null, now = Date.now() }) {
      const row = store.get(jobKey);
      if (!row || row.ownerId !== ownerId) return { count: 0 };
      row.leaseExpiresAt = new Date(now);
      row.lastFinishedAt = new Date(now);
      row.lastStatus = status;
      row.lastError = error ? String(error).slice(0, 2000) : null;
      row.updatedAt = new Date(now);
      return { count: 1 };
    },
  };
}

/**
 * Acquire a lease via PostgreSQL. Returns the lease row or null if held by another owner.
 */
export async function tryAcquireJobLease(prisma, { jobKey, ownerId, leaseMs }) {
  const expiresAt = new Date(Date.now() + leaseMs);
  const rows = await prisma.$queryRaw`
    INSERT INTO "JobLease" ("jobKey", "ownerId", "leaseExpiresAt", "lastStartedAt", "updatedAt")
    VALUES (${jobKey}, ${ownerId}, ${expiresAt}, NOW(), NOW())
    ON CONFLICT ("jobKey") DO UPDATE
    SET
      "ownerId" = EXCLUDED."ownerId",
      "leaseExpiresAt" = EXCLUDED."leaseExpiresAt",
      "lastStartedAt" = NOW(),
      "updatedAt" = NOW(),
      "lastStatus" = NULL,
      "lastError" = NULL
    WHERE "JobLease"."leaseExpiresAt" <= NOW()
       OR "JobLease"."ownerId" = EXCLUDED."ownerId"
    RETURNING *
  `;
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

/** Extend lease while a long-running job is still executing. */
export async function renewJobLease(prisma, { jobKey, ownerId, leaseMs }) {
  const expiresAt = new Date(Date.now() + leaseMs);
  const rows = await prisma.$queryRaw`
    UPDATE "JobLease"
    SET "leaseExpiresAt" = ${expiresAt}, "updatedAt" = NOW()
    WHERE "jobKey" = ${jobKey}
      AND "ownerId" = ${ownerId}
      AND "leaseExpiresAt" > NOW()
    RETURNING *
  `;
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

/** Mark finished and open the lease for the next claimant. */
export async function releaseJobLease(prisma, { jobKey, ownerId, status, error = null }) {
  const errText = error != null ? String(error).slice(0, 2000) : null;
  const rows = await prisma.$queryRaw`
    UPDATE "JobLease"
    SET
      "leaseExpiresAt" = NOW(),
      "lastFinishedAt" = NOW(),
      "lastStatus" = ${status},
      "lastError" = ${errText},
      "updatedAt" = NOW()
    WHERE "jobKey" = ${jobKey}
      AND "ownerId" = ${ownerId}
    RETURNING *
  `;
  return { count: Array.isArray(rows) ? rows.length : 0 };
}

/**
 * @param {object} leaseApi — prisma-backed helpers or memory store
 * @param {{ jobKey: string, ownerId: string, leaseMs: number, heartbeatMs?: number }} opts
 * @param {() => Promise<unknown>} fn
 */
export async function runWithJobLease(leaseApi, opts, fn) {
  const { jobKey, ownerId, leaseMs } = opts;
  const heartbeatMs =
    opts.heartbeatMs ?? Math.max(Math.floor(leaseMs / 3), 5_000);

  const acquire =
    typeof leaseApi.tryAcquire === 'function'
      ? () => leaseApi.tryAcquire({ jobKey, ownerId, leaseMs })
      : () => tryAcquireJobLease(leaseApi, { jobKey, ownerId, leaseMs });

  const renew =
    typeof leaseApi.renew === 'function'
      ? () => leaseApi.renew({ jobKey, ownerId, leaseMs })
      : () => renewJobLease(leaseApi, { jobKey, ownerId, leaseMs });

  const release =
    typeof leaseApi.release === 'function'
      ? (payload) => leaseApi.release({ jobKey, ownerId, ...payload })
      : (payload) => releaseJobLease(leaseApi, { jobKey, ownerId, ...payload });

  const claimed = await acquire();
  if (!claimed) {
    return { ran: false, reason: 'lock_held' };
  }

  let heartbeat = null;
  try {
    heartbeat = setInterval(() => {
      renew().catch((err) => {
        console.error(`[job-lease] renew failed for ${jobKey}`, err?.message || err);
      });
    }, heartbeatMs);
    if (typeof heartbeat.unref === 'function') heartbeat.unref();

    const result = await fn();
    await release({ status: JOB_LEASE_STATUS.SUCCESS });
    return { ran: true, result };
  } catch (err) {
    await release({
      status: JOB_LEASE_STATUS.FAILED,
      error: err?.message || String(err),
    }).catch((releaseErr) => {
      console.error(
        `[job-lease] failed to record FAILED status for ${jobKey}`,
        releaseErr?.message || releaseErr
      );
    });
    throw err;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }
}
