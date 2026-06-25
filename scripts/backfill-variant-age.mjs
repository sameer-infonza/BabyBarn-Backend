/**
 * Backfill the Age variant axis + denormalized Product.ageGroups.
 *
 * For each variant_matrix product whose variants lack a canonical `Age` in their
 * combination, inject `combination.Age = sizeAgeGroup` (when canonical). Then set
 * Product.ageGroups from the distinct variant ages (variant products) or from the
 * single sizeAgeGroup (simple products).
 *
 * Idempotent: rows already carrying a canonical Age / correct ageGroups are skipped.
 *
 * Usage: node scripts/backfill-variant-age.mjs   (run after `prisma migrate deploy`)
 */
import { PrismaClient } from '@prisma/client';
import { AGE_AXIS_NAME, ageOrderIndex, isCanonicalAge } from '../lib/age-groups.js';

const prisma = new PrismaClient();

function distinctSortedAges(values) {
  return Array.from(new Set(values.filter(isCanonicalAge).map((v) => String(v).trim()))).sort(
    (a, b) => ageOrderIndex(a) - ageOrderIndex(b)
  );
}

function sameArray(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

async function main() {
  const products = await prisma.product.findMany({
    select: {
      id: true,
      sku: true,
      inventoryModel: true,
      sizeAgeGroup: true,
      ageGroups: true,
      variants: { select: { id: true, combination: true } },
    },
  });

  let variantsUpdated = 0;
  let productsUpdated = 0;
  let skipped = 0;

  for (const p of products) {
    const isVariant = p.inventoryModel === 'variant_matrix' && p.variants.length > 0;
    const productAge = isCanonicalAge(p.sizeAgeGroup) ? String(p.sizeAgeGroup).trim() : null;

    let ageGroups;

    if (isVariant) {
      for (const v of p.variants) {
        const combo =
          v.combination && typeof v.combination === 'object' && !Array.isArray(v.combination)
            ? { ...v.combination }
            : {};
        const hasCanonicalAge = isCanonicalAge(combo[AGE_AXIS_NAME]);
        if (!hasCanonicalAge && productAge) {
          combo[AGE_AXIS_NAME] = productAge;
          await prisma.productVariant.update({
            where: { id: v.id },
            data: { combination: combo },
          });
          v.combination = combo;
          variantsUpdated += 1;
        }
      }
      ageGroups = distinctSortedAges(p.variants.map((v) => v.combination?.[AGE_AXIS_NAME]));
    } else {
      ageGroups = productAge ? [productAge] : [];
    }

    const current = Array.isArray(p.ageGroups) ? p.ageGroups : [];
    if (!sameArray(current, ageGroups)) {
      await prisma.product.update({
        where: { id: p.id },
        data: { ageGroups },
      });
      productsUpdated += 1;
    } else {
      skipped += 1;
    }
  }

  console.log(`Variants given an Age: ${variantsUpdated}`);
  console.log(`Products with ageGroups updated: ${productsUpdated}`);
  console.log(`Products already up to date: ${skipped}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
