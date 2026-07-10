import { prisma } from '../lib/prisma.js';
import { AppError } from '../utils/error-handler.js';
import { slugifyName } from '../utils/slug.js';
import { writeInventoryLedger } from './inventory-ledger.service.js';

export function refurbPriceFrom(amount) {
  if (amount == null || Number.isNaN(Number(amount))) return null;
  return Math.round(Number(amount) * 0.85 * 100) / 100;
}

export function refurbVariantSku(sourceVariantSku) {
  return `${sourceVariantSku}-RF`;
}

export function findRefurbVariantForSource(refurbVariants, sourceVariant) {
  const bySku = refurbVariants.find((rv) => rv.sku === refurbVariantSku(sourceVariant.sku));
  if (bySku) return bySku;
  const combo = JSON.stringify(sourceVariant.combination ?? {});
  return refurbVariants.find((rv) => JSON.stringify(rv.combination ?? {}) === combo);
}

function clampStock(n, { allowZero = false } = {}) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return allowZero ? 0 : 1;
  if (allowZero && v <= 0) return 0;
  if (!Number.isFinite(v) || v < 1) return 1;
  return Math.min(v, 99);
}

function sourceHasCanonicalAge(sourceFull) {
  const age = typeof sourceFull.sizeAgeGroup === 'string' ? sourceFull.sizeAgeGroup.trim() : '';
  if (!age) return false;
  // Canonical ages match customer/admin AGE presets (e.g. 0-3M).
  return /^(0-3M|3-6M|6-9M|9-12M|12-18M|18-24M)$/i.test(age);
}

/**
 * Create or restock a refurb listing linked to a NEW source product.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
export async function listOrRestockRefurbForSourceInTx(tx, {
  sourceFull,
  sourceVariantId = null,
  linePrice = null,
  initialStock = 1,
  conditionGrade = null,
  sourceReturnId = null,
  actorUserId = null,
  ledgerReference,
  unitReturnRequestId = null,
  createAsDraft = false,
}) {
  if (!sourceFull) throw new AppError(400, 'Source product missing');
  if (sourceFull.productType !== 'NEW') {
    throw new AppError(400, 'Refurb listings can only be created from new catalog products');
  }

  const isVariantSource =
    sourceFull.inventoryModel === 'variant_matrix' && sourceFull.variants.length > 0;
  const lineVariant = sourceVariantId
    ? sourceFull.variants.find((v) => v.id === sourceVariantId)
    : isVariantSource && sourceFull.variants.length === 1
      ? sourceFull.variants[0]
      : null;

  // Manual shells without age / without a chosen variant stay draft until admin finishes Age Groups.
  const needsAgeConfig = !isVariantSource && !sourceHasCanonicalAge(sourceFull);
  const cloneAllVariants = isVariantSource && !lineVariant;
  const asDraft = Boolean(createAsDraft) || needsAgeConfig || cloneAllVariants;
  const qty = clampStock(initialStock, { allowZero: asDraft });

  const refurbSku = `${sourceFull.sku}-RF`;

  const existing = await tx.product.findFirst({
    where: {
      productType: 'REFURBISHED',
      sourceProductId: sourceFull.id,
      isActiveListing: true,
    },
    include: { variants: { orderBy: { sortOrder: 'asc' } } },
  });


  if (existing) {
    if (asDraft && qty < 1) {
      // Opening an existing listing for edit — no stock change.
      return {
        product: existing,
        restocked: false,
      };
    }
    const { syncParentStockFromVariants } = await import('./inventory.service.js');
    let ledgerVariantId = null;

    if (existing.variants.length > 0) {
      if (!lineVariant) {
        throw new AppError(
          400,
          'Select a variant for this product — variant-matrix refurb requires a source variant'
        );
      }
      const refurbVariant = findRefurbVariantForSource(existing.variants, lineVariant);
      if (!refurbVariant) {
        throw new AppError(400, 'Refurb variant row missing for source SKU — contact support');
      }
      await tx.productVariant.update({
        where: { id: refurbVariant.id },
        data: { stock: refurbVariant.stock + qty },
      });
      await syncParentStockFromVariants(tx, existing.id);
      ledgerVariantId = refurbVariant.id;
    } else {
      await tx.product.update({
        where: { id: existing.id },
        data: { stock: existing.stock + qty },
      });
    }

    await tx.product.update({
      where: { id: existing.id },
      data: {
        conditionGrade: conditionGrade ?? existing.conditionGrade,
      },
    });

    await writeInventoryLedger(tx, {
      productId: existing.id,
      productVariantId: ledgerVariantId,
      quantityDelta: qty,
      eventType: 'RESTOCK',
      referenceType: ledgerReference.type,
      referenceId: ledgerReference.id,
      actorUserId,
      note: 'Refurbished unit restocked',
    });

    if (unitReturnRequestId) {
      await relinkUnitsForReturn(tx, {
        returnRequestId: unitReturnRequestId,
        productId: existing.id,
        refurbSku,
        note: `Restocked on existing refurb SKU ${refurbSku}`,
      });
    }

    return {
      product: await tx.product.findUnique({
        where: { id: existing.id },
        include: { variants: { orderBy: { sortOrder: 'asc' } }, category: true },
      }),
      restocked: true,
    };
  }

  // Also find inactive/draft shells for the same source so we don't duplicate.
  const existingAny = await tx.product.findFirst({
    where: {
      productType: 'REFURBISHED',
      sourceProductId: sourceFull.id,
    },
    include: { variants: { orderBy: { sortOrder: 'asc' } }, category: true },
  });
  if (existingAny) {
    return { product: existingAny, restocked: false };
  }

  const baseName = `${sourceFull.name} (Refurbished)`;
  const slugBase = slugifyName(baseName);
  const { ensureUniqueSlug } = await import('./product.service.js');
  const slug = await ensureUniqueSlug(tx, `${slugBase}-${sourceFull.slug.slice(-6)}`);

  const refurbPrice =
    refurbPriceFrom(sourceFull.memberPrice) ??
    refurbPriceFrom(linePrice) ??
    refurbPriceFrom(sourceFull.price) ??
    0;

  const product = await tx.product.create({
    data: {
      name: baseName,
      slug,
      sku: refurbSku,
      description: sourceFull.description,
      price: refurbPrice,
      memberPrice: refurbPriceFrom(sourceFull.memberPrice),
      compareAtPrice: sourceFull.compareAtPrice ?? sourceFull.price,
      stock: isVariantSource ? 0 : qty,
      reservedStock: 0,
      inventoryModel: isVariantSource ? 'variant_matrix' : 'simple',
      categoryId: sourceFull.categoryId,
      imageUrl: sourceFull.imageUrl,
      gallery: sourceFull.gallery ?? undefined,
      fabric: sourceFull.fabric,
      care: sourceFull.care,
      sizeAgeGroup: sourceFull.sizeAgeGroup,
      vendor: sourceFull.vendor,
      tags: sourceFull.tags,
      productType: 'REFURBISHED',
      isDraft: asDraft,
      isActiveListing: !asDraft,
      sourceReturnId: sourceReturnId ?? null,
      sourceProductId: sourceFull.id,
      conditionGrade: conditionGrade ?? null,
      refurbishedAt: new Date(),
    },
  });

  const { syncParentStockFromVariants } = await import('./inventory.service.js');
  let ledgerVariantId = null;

  if (isVariantSource) {
    for (const sv of sourceFull.variants) {
      const isTarget = lineVariant ? sv.id === lineVariant.id : false;
      const variantPrice = sv.priceOverride != null ? refurbPriceFrom(sv.priceOverride) : refurbPrice;
      const created = await tx.productVariant.create({
        data: {
          productId: product.id,
          combination: sv.combination,
          sku: refurbVariantSku(sv.sku),
          stock: isTarget ? qty : 0,
          reservedStock: 0,
          priceOverride: variantPrice,
          imageUrl: sv.imageUrl,
          sortOrder: sv.sortOrder,
        },
      });
      if (isTarget) ledgerVariantId = created.id;
    }
    await syncParentStockFromVariants(tx, product.id);
  }

  if (qty > 0) {
    await writeInventoryLedger(tx, {
      productId: product.id,
      productVariantId: ledgerVariantId,
      quantityDelta: qty,
      eventType: 'RESTOCK',
      referenceType: ledgerReference.type,
      referenceId: ledgerReference.id,
      actorUserId,
      note: ledgerReference.note || 'Refurbished unit listed',
    });
  }

  if (unitReturnRequestId) {
    await relinkUnitsForReturn(tx, {
      returnRequestId: unitReturnRequestId,
      productId: product.id,
      refurbSku,
      note: `Listed as refurb SKU ${refurbSku}`,
    });
  }

  return {
    product: await tx.product.findUnique({
      where: { id: product.id },
      include: { variants: { orderBy: { sortOrder: 'asc' } }, category: true },
    }),
    restocked: false,
  };
}

async function relinkUnitsForReturn(tx, { returnRequestId, productId, refurbSku, note }) {
  const units = await tx.productUnit.findMany({ where: { sourceReturnId: returnRequestId } });
  for (const unit of units) {
    await tx.productUnit.update({
      where: { id: unit.id },
      data: { status: 'AVAILABLE_REFURB', productId, relistedAt: new Date() },
    });
    await tx.productUnitEvent.create({
      data: {
        unitId: unit.id,
        fromStatus: unit.status,
        toStatus: 'AVAILABLE_REFURB',
        note,
      },
    });
  }
}

export async function listOrRestockRefurbForSource({
  sourceProductPublicId,
  sourceVariantPublicId = null,
  initialStock = 1,
  conditionGrade = null,
  actorUserId = null,
  ledgerReference,
  createAsDraft = false,
}) {
  const sourceFull = await prisma.product.findUnique({
    where: { publicId: sourceProductPublicId },
    include: { variants: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!sourceFull) throw new AppError(404, 'Source product not found');
  if (!sourceFull.isActiveListing || sourceFull.isDraft) {
    throw new AppError(400, 'Source product must be an active new listing');
  }

  let sourceVariantId = null;
  if (sourceVariantPublicId) {
    const variant = sourceFull.variants.find((v) => v.publicId === sourceVariantPublicId);
    if (!variant) throw new AppError(404, 'Source variant not found on product');
    sourceVariantId = variant.id;
  }

  return prisma.$transaction((tx) =>
    listOrRestockRefurbForSourceInTx(tx, {
      sourceFull,
      sourceVariantId,
      initialStock,
      conditionGrade,
      sourceReturnId: null,
      actorUserId,
      ledgerReference,
      createAsDraft,
    })
  );
}
