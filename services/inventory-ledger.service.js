/**
 * Append-only inventory ledger for reserve / commit / adjust / restock events.
 */

/** @typedef {{ referenceType: string; referenceId: string; actorUserId?: number | null; note?: string | null }} LedgerContext */

function referenceActorKey(referenceType, referenceId) {
  return `${referenceType}:${referenceId}`;
}

function serializeLedgerActor(user) {
  return {
    id: user.publicId,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role?.name ?? null,
  };
}

/** Resolve customer/admin actors for ledger rows missing actorUserId (legacy order/checkout events). */
async function resolveReferenceActors(prisma, rows) {
  const refToUserId = new Map();
  const orderPublicIds = new Set();
  const intentReferenceIds = new Set();

  for (const row of rows) {
    if (row.actorUserId) continue;
    const { referenceType, referenceId } = row;
    if (!referenceType || !referenceId) continue;

    if (referenceType === 'order') {
      if (referenceId.startsWith('pending:')) {
        const userId = Number.parseInt(referenceId.slice('pending:'.length), 10);
        if (!Number.isNaN(userId)) {
          refToUserId.set(referenceActorKey(referenceType, referenceId), userId);
        }
      } else {
        orderPublicIds.add(referenceId);
      }
      continue;
    }

    if (referenceType === 'checkout_intent') {
      intentReferenceIds.add(referenceId);
    }
  }

  if (orderPublicIds.size > 0) {
    const orders = await prisma.order.findMany({
      where: { publicId: { in: [...orderPublicIds] } },
      select: { publicId: true, userId: true },
    });
    for (const order of orders) {
      if (order.userId) {
        refToUserId.set(referenceActorKey('order', order.publicId), order.userId);
      }
    }
  }

  if (intentReferenceIds.size > 0) {
    const refs = [...intentReferenceIds];
    const intents = await prisma.checkoutIntent.findMany({
      where: {
        OR: [{ publicId: { in: refs } }, { checkoutSignature: { in: refs } }],
      },
      select: { publicId: true, checkoutSignature: true, userId: true },
    });
    for (const intent of intents) {
      if (!intent.userId) continue;
      refToUserId.set(referenceActorKey('checkout_intent', intent.publicId), intent.userId);
      if (intent.checkoutSignature) {
        refToUserId.set(referenceActorKey('checkout_intent', intent.checkoutSignature), intent.userId);
      }
    }
  }

  const userIds = [...new Set([...refToUserId.values()].filter(Boolean))];
  if (!userIds.length) return new Map();

  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      publicId: true,
      email: true,
      firstName: true,
      lastName: true,
      role: { select: { name: true } },
    },
  });
  const userById = new Map(users.map((user) => [user.id, user]));

  const refToActor = new Map();
  for (const [key, userId] of refToUserId) {
    const user = userById.get(userId);
    if (user) refToActor.set(key, serializeLedgerActor(user));
  }
  return refToActor;
}

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
            role: { select: { name: true } },
          },
        })
      : [];
  const actorById = new Map(actors.map((actor) => [actor.id, actor]));
  const refActorByKey = await resolveReferenceActors(prisma, rows);

  const { combinationLabel } = await import('./inventory.service.js');

  return {
    entries: rows.map((r) => {
      const actorRow = r.actorUserId ? actorById.get(r.actorUserId) : null;
      const actor =
        actorRow != null
          ? serializeLedgerActor(actorRow)
          : refActorByKey.get(referenceActorKey(r.referenceType, r.referenceId)) ?? null;
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
        actor,
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
