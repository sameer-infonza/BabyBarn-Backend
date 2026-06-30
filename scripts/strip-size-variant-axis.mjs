/**
 * Remove the legacy "Size" axis (and any non-Age/Color keys) from variant
 * combination JSON. Age is the only buyable variant axis going forward; Color is
 * also allowed. Everything else (notably "Size") is stripped from the stored
 * `ProductVariant.combination`.
 *
 * Idempotent: variants whose combinations already contain only allowed keys are
 * left untouched.
 *
 * Usage: node scripts/strip-size-variant-axis.mjs   (run after `prisma migrate deploy`)
 */
import { PrismaClient } from '@prisma/client';
import { isAgeAxisKey } from '../lib/age-groups.js';

const prisma = new PrismaClient();

function isAllowedAxisKey(key) {
  if (typeof key !== 'string') return false;
  const k = key.trim().toLowerCase();
  return isAgeAxisKey(key) || k === 'color' || k === 'colour';
}

async function main() {
  const variants = await prisma.productVariant.findMany({
    select: { id: true, sku: true, combination: true },
  });

  let updated = 0;
  let skipped = 0;

  for (const v of variants) {
    const combo =
      v.combination && typeof v.combination === 'object' && !Array.isArray(v.combination)
        ? v.combination
        : null;
    if (!combo) {
      skipped += 1;
      continue;
    }

    const cleaned = {};
    let removedAny = false;
    for (const [key, value] of Object.entries(combo)) {
      if (isAllowedAxisKey(key)) {
        cleaned[key] = value;
      } else {
        removedAny = true;
      }
    }

    if (!removedAny) {
      skipped += 1;
      continue;
    }

    await prisma.productVariant.update({
      where: { id: v.id },
      data: { combination: cleaned },
    });
    updated += 1;
  }

  console.log(`Variants cleaned (Size/other axes removed): ${updated}`);
  console.log(`Variants already clean: ${skipped}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
