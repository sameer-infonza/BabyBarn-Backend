import { randomBytes } from 'crypto';
import { AGE_AXIS_NAME, ageOrderIndex, isCanonicalAge } from './age-groups.js';

function randomSku(prefix) {
  const hex = randomBytes(5).toString('hex').toUpperCase();
  return `${prefix}-${hex}`;
}

async function ensureUniqueParentSku(tx) {
  for (let i = 0; i < 20; i += 1) {
    const sku = randomSku('PARENT');
    const exists = await tx.product.findUnique({ where: { sku }, select: { id: true } });
    if (!exists) return sku;
  }
  throw new Error('Could not allocate a unique parent SKU');
}

function computeAgeGroupsFromVariants(variants) {
  const set = new Set();
  for (const v of variants) {
    const combo = v?.combination;
    const age = combo && typeof combo === 'object' ? combo[AGE_AXIS_NAME] : null;
    if (isCanonicalAge(age)) set.add(String(age).trim());
  }
  return Array.from(set).sort((a, b) => ageOrderIndex(a) - ageOrderIndex(b));
}

/**
 * @param {import('@prisma/client').Product & { variants?: Array<{ id: number }> }} product
 */
export function describeSimpleToVariantMigration(product) {
  const reasons = [];
  if (product.inventoryModel === 'variant_matrix' && (product.variants?.length ?? 0) > 0) {
    reasons.push('already_variant_matrix');
  }
  if ((product.variants?.length ?? 0) > 0) {
    reasons.push('has_variants');
  }
  if (!isCanonicalAge(product.sizeAgeGroup)) {
    reasons.push('missing_or_invalid_size_age_group');
  }
  if (!(product.sku ?? '').trim()) {
    reasons.push('missing_product_sku');
  }
  if (product.sourceReturnId != null) {
    reasons.push('pipeline_refurb_listing');
  }
  return {
    eligible: reasons.length === 0,
    reasons,
    age: isCanonicalAge(product.sizeAgeGroup) ? String(product.sizeAgeGroup).trim() : null,
  };
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {import('@prisma/client').Product} product
 * @param {{ dryRun?: boolean }} [options]
 */
export async function migrateSimpleProductToVariantMatrix(tx, product, options = {}) {
  const { dryRun = false } = options;
  const assessment = describeSimpleToVariantMigration(product);
  if (!assessment.eligible) {
    return { status: 'skipped', productId: product.id, sku: product.sku, reasons: assessment.reasons };
  }

  const age = assessment.age;
  const variantSku = String(product.sku).trim();
  const stock = Math.max(0, Number(product.stock) || 0);
  const reservedStock = Math.max(0, Number(product.reservedStock) || 0);
  const parentSku = await ensureUniqueParentSku(tx);

  const variantPayload = {
    combination: { [AGE_AXIS_NAME]: age },
    sku: variantSku,
    stock,
    reservedStock,
    priceOverride: null,
    imageUrl: product.imageUrl ?? null,
    sortOrder: 0,
  };

  if (dryRun) {
    return {
      status: 'would_migrate',
      productId: product.id,
      previousSku: variantSku,
      parentSku,
      age,
      stock,
      reservedStock,
      variantPayload,
    };
  }

  const clash = await tx.product.findFirst({
    where: { sku: variantSku, NOT: { id: product.id } },
    select: { id: true },
  });
  if (clash) {
    return {
      status: 'error',
      productId: product.id,
      sku: variantSku,
      reasons: ['variant_sku_conflicts_with_another_product'],
    };
  }

  await tx.productVariant.create({
    data: {
      productId: product.id,
      ...variantPayload,
    },
  });

  const ageGroups = computeAgeGroupsFromVariants([{ combination: variantPayload.combination }]);

  await tx.product.update({
    where: { id: product.id },
    data: {
      sku: parentSku,
      inventoryModel: 'variant_matrix',
      ageGroups,
      sizeAgeGroup: null,
      stock,
      reservedStock: 0,
    },
  });

  return {
    status: 'migrated',
    productId: product.id,
    previousSku: variantSku,
    parentSku,
    age,
    stock,
    reservedStock,
  };
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ dryRun?: boolean, limit?: number, productIds?: number[] }} [options]
 */
export async function runSimpleToVariantMigration(prisma, options = {}) {
  const { dryRun = false, limit, productIds } = options;

  const where = {
    inventoryModel: 'simple',
    variants: { none: {} },
    sourceReturnId: null,
    ...(Array.isArray(productIds) && productIds.length > 0 ? { id: { in: productIds } } : {}),
  };

  const products = await prisma.product.findMany({
    where,
    include: { variants: { select: { id: true } } },
    orderBy: { id: 'asc' },
    ...(typeof limit === 'number' && limit > 0 ? { take: limit } : {}),
  });

  const summary = {
    dryRun,
    scanned: products.length,
    migrated: 0,
    wouldMigrate: 0,
    skipped: 0,
    errors: 0,
    results: [],
  };

  for (const product of products) {
    const runOne = async (tx) => migrateSimpleProductToVariantMatrix(tx, product, { dryRun });

    const result = dryRun ? await runOne(prisma) : await prisma.$transaction((tx) => runOne(tx));

    summary.results.push(result);
    if (result.status === 'migrated') summary.migrated += 1;
    else if (result.status === 'would_migrate') summary.wouldMigrate += 1;
    else if (result.status === 'error') summary.errors += 1;
    else summary.skipped += 1;
  }

  return summary;
}
