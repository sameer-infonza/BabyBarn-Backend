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
  search = null,
}) {
  const { prisma } = await import('../lib/prisma.js');
  const skip = (page - 1) * limit;
  const and = [];

  if (productPublicId) {
    const product = await prisma.product.findUnique({
      where: { publicId: productPublicId },
      select: { id: true },
    });
    if (!product) return { entries: [], pagination: { total: 0, page, limit, pages: 1 } };
    and.push({ productId: product.id });
  } else if (productType === 'NEW' || productType === 'REFURBISHED') {
    and.push({ product: { productType } });
  }

  const q = search ? String(search).trim() : '';
  if (q) {
    and.push({
      OR: [
        { product: { name: { contains: q, mode: 'insensitive' } } },
        { product: { sku: { contains: q, mode: 'insensitive' } } },
        { productVariant: { sku: { contains: q, mode: 'insensitive' } } },
        { note: { contains: q, mode: 'insensitive' } },
        { referenceId: { contains: q, mode: 'insensitive' } },
      ],
    });
  }

  const where = and.length ? { AND: and } : {};

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

  const actorIds = [...new Set(rows.map((row) => row.actorUserId).filter(Boolean))];
  const actors =
    actorIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: {
            id: true,
            publicId: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        })
      : [];
  const actorById = new Map(actors.map((actor) => [actor.id, actor]));

  const { combinationLabel } = await import('./inventory.service.js');

  return {
    entries: rows.map((r) => {
      const actor = r.actorUserId ? actorById.get(r.actorUserId) : null;
      return {
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
        actor: actor
          ? {
              id: actor.publicId,
              email: actor.email,
              firstName: actor.firstName,
              lastName: actor.lastName,
            }
          : null,
      };
    }),
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit) || 1,
    },
  };
}
