/**
 * Append-only inventory ledger for reserve / commit / adjust / restock events.
 */

/** @typedef {{ referenceType: string; referenceId: string; actorUserId?: number | null; note?: string | null }} LedgerContext */

export async function writeInventoryLedger(tx, {
  productId,
  productVariantId = null,
  quantityDelta,
  eventType,
  referenceType,
  referenceId,
  actorUserId = null,
  note = null,
}) {
  if (!productId || !eventType || !referenceType || !referenceId) return;
  await tx.inventoryLedgerEvent.create({
    data: {
      productId,
      productVariantId,
      quantityDelta,
      eventType,
      referenceType,
      referenceId,
      actorUserId,
      note,
    },
  });
}

export async function listLedgerHistory({
  page = 1,
  limit = 20,
  productPublicId = null,
  productType = null,
}) {
  const { prisma } = await import('../lib/prisma.js');
  const skip = (page - 1) * limit;
  const where = {};
  if (productPublicId) {
    const product = await prisma.product.findUnique({
      where: { publicId: productPublicId },
      select: { id: true },
    });
    if (!product) return { entries: [], pagination: { total: 0, page, limit, pages: 1 } };
    where.productId = product.id;
  } else if (productType === 'NEW' || productType === 'REFURBISHED') {
    where.product = { productType };
  }

  const [rows, total] = await Promise.all([
    prisma.inventoryLedgerEvent.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        product: { select: { publicId: true, name: true, sku: true } },
        productVariant: { select: { publicId: true, sku: true, combination: true } },
      },
    }),
    prisma.inventoryLedgerEvent.count({ where }),
  ]);

  const { combinationLabel } = await import('./inventory.service.js');

  return {
    entries: rows.map((r) => ({
      id: r.publicId,
      eventType: r.eventType,
      quantityDelta: r.quantityDelta,
      referenceType: r.referenceType,
      referenceId: r.referenceId,
      note: r.note,
      createdAt: r.createdAt,
      product: {
        id: r.product.publicId,
        name: r.product.name,
        sku: r.product.sku,
      },
      variant: r.productVariant
        ? {
            id: r.productVariant.publicId,
            sku: r.productVariant.sku,
            combinationLabel: combinationLabel(r.productVariant.combination),
          }
        : null,
    })),
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit) || 1,
    },
  };
}
