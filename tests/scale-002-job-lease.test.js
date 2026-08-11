import test from 'node:test';
import assert from 'node:assert/strict';
import {
  JOB_LEASE_STATUS,
  createMemoryJobLeaseStore,
  decideLeaseClaim,
  runWithJobLease,
} from '../lib/job-lease.js';
import { startScheduledJobs, runScheduledJob } from '../services/scheduled-jobs.service.js';

test('SCALE-002: decideLeaseClaim acquires when empty', () => {
  const d = decideLeaseClaim(null, {
    jobKey: 'job-a',
    ownerId: 'A',
    leaseMs: 60_000,
    now: 1_000,
  });
  assert.equal(d.acquired, true);
  assert.equal(d.row.ownerId, 'A');
  assert.equal(d.row.leaseExpiresAt.getTime(), 61_000);
});

test('SCALE-002: concurrent claim — second owner blocked while lease valid', () => {
  const held = {
    jobKey: 'job-a',
    ownerId: 'A',
    leaseExpiresAt: new Date(50_000),
  };
  const blocked = decideLeaseClaim(held, {
    jobKey: 'job-a',
    ownerId: 'B',
    leaseMs: 60_000,
    now: 10_000,
  });
  assert.equal(blocked.acquired, false);
  assert.equal(blocked.reason, 'lock_held');
});

test('SCALE-002: same owner can re-acquire (re-entrant / duplicate trigger)', () => {
  const held = {
    jobKey: 'job-a',
    ownerId: 'A',
    leaseExpiresAt: new Date(50_000),
  };
  const again = decideLeaseClaim(held, {
    jobKey: 'job-a',
    ownerId: 'A',
    leaseMs: 60_000,
    now: 10_000,
  });
  assert.equal(again.acquired, true);
  assert.equal(again.row.ownerId, 'A');
});

test('SCALE-002: crash recovery — expired lease can be claimed by B', () => {
  const stale = {
    jobKey: 'job-a',
    ownerId: 'A',
    leaseExpiresAt: new Date(5_000),
  };
  const reclaim = decideLeaseClaim(stale, {
    jobKey: 'job-a',
    ownerId: 'B',
    leaseMs: 60_000,
    now: 10_000,
  });
  assert.equal(reclaim.acquired, true);
  assert.equal(reclaim.row.ownerId, 'B');
});

test('SCALE-002: single-instance execution runs domain fn once', async () => {
  const store = createMemoryJobLeaseStore();
  let runs = 0;
  const out = await runWithJobLease(
    store,
    { jobKey: 'once', ownerId: 'A', leaseMs: 30_000, heartbeatMs: 60_000 },
    async () => {
      runs += 1;
      return { ok: true };
    }
  );
  assert.equal(out.ran, true);
  assert.deepEqual(out.result, { ok: true });
  assert.equal(runs, 1);
  assert.equal(store._store.get('once').lastStatus, JOB_LEASE_STATUS.SUCCESS);
});

test('SCALE-002: contention — only one of A/B executes concurrently', async () => {
  const store = createMemoryJobLeaseStore();
  let active = 0;
  let maxActive = 0;
  let completed = 0;

  const work = async (ownerId) => {
    const out = await runWithJobLease(
      store,
      { jobKey: 'contended', ownerId, leaseMs: 60_000, heartbeatMs: 120_000 },
      async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 40));
        active -= 1;
        completed += 1;
        return ownerId;
      }
    );
    return out;
  };

  const [a, b] = await Promise.all([work('A'), work('B')]);
  const ran = [a, b].filter((x) => x.ran);
  assert.equal(ran.length, 1);
  assert.equal(maxActive, 1);
  assert.equal(completed, 1);
  assert.equal([a, b].filter((x) => !x.ran && x.reason === 'lock_held').length, 1);
});

test('SCALE-002: lease expiration allows second instance after crash', async () => {
  const store = createMemoryJobLeaseStore();
  const now = { t: 1_000 };

  // A acquires then "crashes" without release (lease left held).
  const claimed = await store.tryAcquire({
    jobKey: 'crash',
    ownerId: 'A',
    leaseMs: 100,
    now: now.t,
  });
  assert.ok(claimed);

  // Still held
  const early = await store.tryAcquire({
    jobKey: 'crash',
    ownerId: 'B',
    leaseMs: 1000,
    now: now.t + 50,
  });
  assert.equal(early, null);

  // After expiry, B takes over
  const late = await store.tryAcquire({
    jobKey: 'crash',
    ownerId: 'B',
    leaseMs: 1000,
    now: now.t + 200,
  });
  assert.ok(late);
  assert.equal(late.ownerId, 'B');
});

test('SCALE-002: slow job heartbeat renew keeps lease from expiring', async () => {
  const store = createMemoryJobLeaseStore();
  let renewed = 0;
  const wrapped = {
    _store: store._store,
    tryAcquire: (o) => store.tryAcquire(o),
    release: (o) => store.release(o),
    async renew(o) {
      renewed += 1;
      return store.renew(o);
    },
  };

  await runWithJobLease(
    wrapped,
    { jobKey: 'slow', ownerId: 'A', leaseMs: 200, heartbeatMs: 40 },
    async () => {
      await new Promise((r) => setTimeout(r, 150));
      return true;
    }
  );
  assert.ok(renewed >= 2, `expected heartbeats, got ${renewed}`);
  // Another owner cannot steal mid-flight if we check before release finished —
  // after success lease is released (expiresAt = now), so reclaim is expected.
  const after = store._store.get('slow');
  assert.equal(after.lastStatus, JOB_LEASE_STATUS.SUCCESS);
});

test('SCALE-002: failed job releases lease and allows retry', async () => {
  const store = createMemoryJobLeaseStore();
  await assert.rejects(
    () =>
      runWithJobLease(
        store,
        { jobKey: 'fail', ownerId: 'A', leaseMs: 30_000, heartbeatMs: 60_000 },
        async () => {
          throw new Error('boom');
        }
      ),
    /boom/
  );
  assert.equal(store._store.get('fail').lastStatus, JOB_LEASE_STATUS.FAILED);

  let retried = false;
  const out = await runWithJobLease(
    store,
    { jobKey: 'fail', ownerId: 'B', leaseMs: 30_000, heartbeatMs: 60_000 },
    async () => {
      retried = true;
      return 'ok';
    }
  );
  assert.equal(out.ran, true);
  assert.equal(retried, true);
});

test('SCALE-002: duplicate trigger while held skips second run (idempotent ownership)', async () => {
  const store = createMemoryJobLeaseStore();
  let runs = 0;

  const long = runWithJobLease(
    store,
    { jobKey: 'dup', ownerId: 'A', leaseMs: 60_000, heartbeatMs: 120_000 },
    async () => {
      runs += 1;
      await new Promise((r) => setTimeout(r, 50));
      return 1;
    }
  );

  await new Promise((r) => setTimeout(r, 5));
  const skipped = await runWithJobLease(
    store,
    { jobKey: 'dup', ownerId: 'B', leaseMs: 60_000, heartbeatMs: 120_000 },
    async () => {
      runs += 1;
      return 2;
    }
  );
  const first = await long;
  assert.equal(first.ran, true);
  assert.equal(skipped.ran, false);
  assert.equal(runs, 1);
});

test('SCALE-002: startScheduledJobs disabled does not register timers', () => {
  const handle = startScheduledJobs({
    enabled: false,
    jobs: [],
    logger: { log() {}, error() {}, debug() {} },
  });
  assert.equal(handle.enabled, false);
  handle.stop();
});

test('SCALE-002: runScheduledJob wires lease around domain runner', async () => {
  const store = createMemoryJobLeaseStore();
  let hits = 0;
  const jobs = [
    {
      key: 'test-job',
      intervalMs: 60_000,
      leaseMs: 30_000,
      run: async () => {
        hits += 1;
        return { hits };
      },
    },
  ];

  const a = await runScheduledJob('test-job', { db: store, ownerId: 'A', jobs });
  const b = await runScheduledJob('test-job', { db: store, ownerId: 'B', jobs });
  // After A releases, B can run — sequential is fine; concurrency was tested above.
  assert.equal(a.ran, true);
  assert.equal(b.ran, true);
  assert.equal(hits, 2);
});

test('SCALE-002: concurrent runScheduledJob — only one executes', async () => {
  const store = createMemoryJobLeaseStore();
  let active = 0;
  let maxActive = 0;
  const jobs = [
    {
      key: 'parallel-job',
      intervalMs: 60_000,
      leaseMs: 60_000,
      run: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 40));
        active -= 1;
      },
    },
  ];

  const results = await Promise.all([
    runScheduledJob('parallel-job', { db: store, ownerId: 'A', jobs }),
    runScheduledJob('parallel-job', { db: store, ownerId: 'B', jobs }),
    runScheduledJob('parallel-job', { db: store, ownerId: 'C', jobs }),
  ]);
  assert.equal(results.filter((r) => r.ran).length, 1);
  assert.equal(maxActive, 1);
});
