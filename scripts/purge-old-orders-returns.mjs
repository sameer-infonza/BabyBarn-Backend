/**
 * Purge old commerce data (orders + returns) before a cutoff date.
 *
 * Scope (only):
 *   - ReturnRequest (+ cascaded children: status events, refurb jobs, eligibility,
 *     inspection records, receive-package lines, package requests linked to returns)
 *   - Orphan ReturnReceivePackage rows for deleted return submissions
 *   - Order (+ cascaded: order items, tracking events, pickup lines, remaining returns,
 *     return package requests)
 *   - Related AdminNotification / AdminAuditLog rows for those entities (optional cleanup)
 *   - ShippingProviderLog rows tied to deleted order publicIds
 *
 * Does NOT delete: users, products, inventory stock, wallets/store credit, ACCESS/membership,
 * categories, team, or checkout intents.
 *
 * Safety:
 *   - DRY-RUN by default (prints counts + samples only)
 *   - Pass --apply to write deletes
 *   - Cutoff is exclusive: createdAt < cutoff
 *
 * Usage (from backend/ on the server):
 *   node scripts/purge-old-orders-returns.mjs
 *   node scripts/purge-old-orders-returns.mjs --before=2026-07-09
 *   node scripts/purge-old-orders-returns.mjs --before=2026-07-09 --apply
 *   node scripts/purge-old-orders-returns.mjs --returns-only --apply
 *   node scripts/purge-old-orders-returns.mjs --orders-only --apply
 *   node scripts/purge-old-orders-returns.mjs --apply --batch=100
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');
const RETURNS_ONLY = process.argv.includes('--returns-only');
const ORDERS_ONLY = process.argv.includes('--orders-only');

function getArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() : fallback;
}

function parseCutoff(raw) {
  // Default: start of 9 July 2026 (UTC) — deletes everything strictly before that day.
  const value = raw || '2026-07-09';
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid --before value: ${raw}`);
  }
  return date;
}

function sample(rows, mapFn, limit = 8) {
  return rows.slice(0, limit).map(mapFn);
}

async function deleteInBatches(label, ids, batchSize, deleter) {
  let deleted = 0;
  for (let i = 0; i < ids.length; i += batchSize) {
    const chunk = ids.slice(i, i + batchSize);
    const n = await deleter(chunk);
    deleted += n;
    console.log(`  ${label}: deleted ${deleted}/${ids.length}`);
  }
  return deleted;
}

async function main() {
  if (RETURNS_ONLY && ORDERS_ONLY) {
    throw new Error('Use only one of --returns-only or --orders-only');
  }

  const cutoff = parseCutoff(getArg('before'));
  const batchSize = Math.max(1, Number(getArg('batch', '50')) || 50);
  const doReturns = !ORDERS_ONLY;
  const doOrders = !RETURNS_ONLY;

  console.log('══════════════════════════════════════════════');
  console.log('  Purge old orders / returns');
  console.log(`  Mode:     ${APPLY ? 'APPLY (destructive)' : 'DRY-RUN (no writes)'}`);
  console.log(`  Cutoff:   createdAt < ${cutoff.toISOString()}`);
  console.log(`  Scope:    ${doOrders ? 'orders' : ''}${doOrders && doReturns ? ' + ' : ''}${doReturns ? 'returns' : ''}`);
  console.log(`  Batch:    ${batchSize}`);
  console.log('══════════════════════════════════════════════');

  const before = { createdAt: { lt: cutoff } };

  const returns = doReturns
    ? await prisma.returnRequest.findMany({
        where: before,
        select: {
          id: true,
          publicId: true,
          returnNumber: true,
          submissionPublicId: true,
          type: true,
          status: true,
          createdAt: true,
          orderId: true,
        },
        orderBy: { createdAt: 'asc' },
      })
    : [];

  const orders = doOrders
    ? await prisma.order.findMany({
        where: before,
        select: {
          id: true,
          publicId: true,
          orderNumber: true,
          status: true,
          paymentStatus: true,
          createdAt: true,
          _count: { select: { returnRequests: true, orderItems: true } },
        },
        orderBy: { createdAt: 'asc' },
      })
    : [];

  const returnIds = returns.map((r) => r.id);
  const returnPublicIds = returns.map((r) => r.publicId);
  const submissionIds = [...new Set(returns.map((r) => r.submissionPublicId).filter(Boolean))];
  const orderIds = orders.map((o) => o.id);
  const orderPublicIds = orders.map((o) => o.publicId);

  let orphanReceivePackages = 0;
  if (submissionIds.length) {
    orphanReceivePackages = await prisma.returnReceivePackage.count({
      where: { submissionPublicId: { in: submissionIds } },
    });
  }

  const adminNotifCount =
    returnPublicIds.length || orderPublicIds.length
      ? await prisma.adminNotification.count({
          where: {
            OR: [
              ...(returnPublicIds.length
                ? [{ entityType: { in: ['ReturnRequest', 'Return'] }, entityId: { in: returnPublicIds } }]
                : []),
              ...(orderPublicIds.length
                ? [{ entityType: { in: ['Order'] }, entityId: { in: orderPublicIds } }]
                : []),
            ],
          },
        })
      : 0;

  console.log('\nCounts');
  console.log(`  ReturnRequest rows:           ${returns.length}`);
  console.log(`  Order rows:                   ${orders.length}`);
  console.log(`  ReturnReceivePackage (match): ${orphanReceivePackages}`);
  console.log(`  AdminNotification (match):    ${adminNotifCount}`);

  if (returns.length) {
    console.log('\nSample returns:');
    for (const row of sample(returns, (r) => r)) {
      console.log(
        `  - ${row.returnNumber || row.publicId}  ${row.type}/${row.status}  ${row.createdAt.toISOString()}`
      );
    }
  }

  if (orders.length) {
    console.log('\nSample orders:');
    for (const row of sample(orders, (o) => o)) {
      console.log(
        `  - ${row.orderNumber || row.publicId}  ${row.status}/${row.paymentStatus}  items=${row._count.orderItems} returns=${row._count.returnRequests}  ${row.createdAt.toISOString()}`
      );
    }
  }

  if (!APPLY) {
    console.log('\nDry-run only. Re-run with --apply to delete.');
    return;
  }

  if (!returns.length && !orders.length) {
    console.log('\nNothing to delete.');
    return;
  }

  console.log('\nApplying deletes…');

  // 1) Returns first (so we can clean submission-scoped receive packages).
  if (returnIds.length) {
    // Clear soft FKs that may block cascade in some DB states.
    await prisma.product.updateMany({
      where: { sourceReturnId: { in: returnIds } },
      data: { sourceReturnId: null },
    });
    await prisma.productUnit.updateMany({
      where: { sourceReturnId: { in: returnIds } },
      data: { sourceReturnId: null },
    });

    await deleteInBatches('ReturnRequest', returnIds, batchSize, async (chunk) => {
      const result = await prisma.returnRequest.deleteMany({ where: { id: { in: chunk } } });
      return result.count;
    });

    if (submissionIds.length) {
      // Packages are keyed by submissionPublicId (no cascade from ReturnRequest).
      // Only delete a package when no return rows remain for that submission.
      for (const submissionPublicId of submissionIds) {
        const remaining = await prisma.returnRequest.count({ where: { submissionPublicId } });
        if (remaining > 0) continue;
        const pkg = await prisma.returnReceivePackage.deleteMany({ where: { submissionPublicId } });
        if (pkg.count) {
          console.log(`  ReturnReceivePackage: deleted ${pkg.count} for ${submissionPublicId}`);
        }
      }
    }

    if (returnPublicIds.length) {
      await prisma.adminNotification.deleteMany({
        where: {
          entityType: { in: ['ReturnRequest', 'Return'] },
          entityId: { in: returnPublicIds },
        },
      });
      try {
        await prisma.adminAuditLog.deleteMany({
          where: {
            entityType: { in: ['ReturnRequest', 'Return'] },
            entityId: { in: returnPublicIds },
          },
        });
      } catch {
        // Audit table name may differ; ignore if model unavailable.
      }
    }
  }

  // 2) Orders (cascades remaining returns on those orders).
  if (orderIds.length) {
    await deleteInBatches('Order', orderIds, batchSize, async (chunk) => {
      const result = await prisma.order.deleteMany({ where: { id: { in: chunk } } });
      return result.count;
    });

    if (orderPublicIds.length) {
      await prisma.adminNotification.deleteMany({
        where: { entityType: 'Order', entityId: { in: orderPublicIds } },
      });
      await prisma.shippingProviderLog.deleteMany({
        where: { orderPublicId: { in: orderPublicIds } },
      });
      try {
        await prisma.adminAuditLog.deleteMany({
          where: { entityType: 'Order', entityId: { in: orderPublicIds } },
        });
      } catch {
        // ignore
      }
    }
  }

  const leftReturns = doReturns
    ? await prisma.returnRequest.count({ where: before })
    : null;
  const leftOrders = doOrders ? await prisma.order.count({ where: before }) : null;

  console.log('\nDone.');
  if (leftReturns != null) console.log(`  Remaining returns before cutoff: ${leftReturns}`);
  if (leftOrders != null) console.log(`  Remaining orders before cutoff:  ${leftOrders}`);
}

main()
  .catch((err) => {
    console.error('\nFAILED:', err?.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
