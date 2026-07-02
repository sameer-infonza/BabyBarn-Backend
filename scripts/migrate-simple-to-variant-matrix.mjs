#!/usr/bin/env node
/**
 * Migrate legacy simple products (single sizeAgeGroup + product-level stock/SKU)
 * into variant_matrix rows with one Age variant per product.
 *
 * Each migrated product:
 * - Keeps total stock on the parent and on the new variant
 * - Moves the original product SKU to the variant; parent gets a new PARENT-* SKU
 * - Sets inventoryModel = variant_matrix, ageGroups from the variant Age, clears sizeAgeGroup
 * - Moves reservedStock from product to the variant (product reservedStock zeroed)
 *
 * Skips: products that already have variants, invalid/missing age, pipeline refurb listings,
 * or variant SKUs that would clash with another product row.
 *
 * Usage (from backend/ on the server):
 *   node scripts/migrate-simple-to-variant-matrix.mjs --dry-run
 *   node scripts/migrate-simple-to-variant-matrix.mjs
 *   node scripts/migrate-simple-to-variant-matrix.mjs --limit=50
 *   node scripts/migrate-simple-to-variant-matrix.mjs --id=12 --id=34
 *
 * npm:
 *   npm run migrate:simple-variants:dry
 *   npm run migrate:simple-variants
 */
import { prisma } from '../lib/prisma.js';
import { runSimpleToVariantMigration } from '../lib/simple-to-variant-migration.js';

const args = process.argv.slice(2);

function hasFlag(name) {
  return args.includes(name);
}

function flagValue(prefix) {
  const hit = args.find((a) => a.startsWith(`${prefix}=`));
  return hit ? hit.slice(prefix.length + 1).trim() : null;
}

function parseIds() {
  const ids = [];
  for (const arg of args) {
    if (arg.startsWith('--id=')) {
      const n = Number(arg.slice('--id='.length));
      if (Number.isInteger(n) && n > 0) ids.push(n);
    }
  }
  return ids.length > 0 ? ids : undefined;
}

const dryRun = hasFlag('--dry-run');
const limitRaw = flagValue('--limit');
const limit = limitRaw != null ? Number(limitRaw) : undefined;
const productIds = parseIds();

if (limitRaw != null && (!Number.isInteger(limit) || limit <= 0)) {
  console.error('[ERR] --limit must be a positive integer.');
  process.exit(1);
}

async function main() {
  console.log(
    dryRun
      ? '[DRY RUN] Scanning simple products eligible for variant migration...'
      : '[LIVE] Migrating simple products to variant_matrix...'
  );

  const summary = await runSimpleToVariantMigration(prisma, {
    dryRun,
    limit,
    productIds,
  });

  console.log('');
  console.log(`Scanned:        ${summary.scanned}`);
  if (dryRun) {
    console.log(`Would migrate:  ${summary.wouldMigrate}`);
  } else {
    console.log(`Migrated:       ${summary.migrated}`);
  }
  console.log(`Skipped:        ${summary.skipped}`);
  console.log(`Errors:         ${summary.errors}`);

  const interesting = summary.results.filter((r) => r.status !== 'skipped');
  if (interesting.length > 0) {
    console.log('');
    console.log('Details:');
    for (const r of interesting) {
      if (r.status === 'would_migrate' || r.status === 'migrated') {
        console.log(
          `  [${r.status}] #${r.productId} ${r.previousSku} -> parent ${r.parentSku}, Age=${r.age}, stock=${r.stock}`
        );
      } else if (r.status === 'error') {
        console.log(`  [error] #${r.productId} ${r.sku ?? ''}: ${(r.reasons ?? []).join(', ')}`);
      }
    }
  }

  const skippedWithReasons = summary.results.filter(
    (r) => r.status === 'skipped' && Array.isArray(r.reasons) && r.reasons.length > 0
  );
  if (skippedWithReasons.length > 0 && skippedWithReasons.length <= 20) {
    console.log('');
    console.log('Skipped (sample):');
    for (const r of skippedWithReasons) {
      console.log(`  #${r.productId} ${r.sku ?? ''}: ${r.reasons.join(', ')}`);
    }
  } else if (skippedWithReasons.length > 20) {
    console.log('');
    console.log(`Skipped ${skippedWithReasons.length} products (use --id= to inspect one).`);
  }

  if (summary.errors > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
