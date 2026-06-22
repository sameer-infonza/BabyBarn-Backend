/**
 * One-off data remap: align Product.sizeAgeGroup with the canonical Age value set.
 *
 * Clean matches are remapped; ambiguous/dropped buckets are cleared (set to null)
 * so an admin re-selects a valid Age. Unrecognized values are left untouched.
 *
 * Usage: node scripts/remap-age-groups.mjs
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// old stored value -> new canonical value (null clears it)
const REMAP = {
  '0-3': '0-3M',
  '3-6': '3-6M',
  '6-12': null, // splits into 6-9M / 9-12M -> admin must re-select
  newborn: null,
  '1-2': null,
  '2-3': null,
};

// Values that are already canonical and should be left as-is.
const CANONICAL = new Set(['0-3M', '3-6M', '6-9M', '9-12M', '12-18M', '18-24M']);

async function main() {
  const products = await prisma.product.findMany({
    select: { id: true, sku: true, sizeAgeGroup: true },
  });

  let remapped = 0;
  let cleared = 0;
  let skipped = 0;
  const unknown = [];

  for (const p of products) {
    const current = p.sizeAgeGroup;
    if (current == null || current === '') {
      skipped += 1;
      continue;
    }
    if (CANONICAL.has(current)) {
      skipped += 1;
      continue;
    }
    if (!(current in REMAP)) {
      unknown.push({ id: p.id, sku: p.sku, value: current });
      continue;
    }
    const next = REMAP[current];
    await prisma.product.update({
      where: { id: p.id },
      data: { sizeAgeGroup: next },
    });
    if (next === null) cleared += 1;
    else remapped += 1;
  }

  console.log(`Remapped: ${remapped}`);
  console.log(`Cleared (re-select needed): ${cleared}`);
  console.log(`Left as-is (already canonical/empty): ${skipped}`);
  if (unknown.length > 0) {
    console.log(`Unrecognized values left untouched (${unknown.length}):`);
    for (const u of unknown) console.log(`  - #${u.id} ${u.sku}: "${u.value}"`);
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
