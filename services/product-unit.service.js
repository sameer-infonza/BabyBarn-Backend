import { prisma } from '../lib/prisma.js';

function unitSkuFromOrder(orderPublicId, orderItemId, index) {
  return `BBU-${orderPublicId.slice(-8)}-${orderItemId}-${index}`.toUpperCase();
}

async function recordUnitEvent(tx, unitId, fromStatus, toStatus, note, actorUserId = null) {
  await tx.productUnitEvent.create({
    data: {
      unitId,
      fromStatus,
      toStatus,
      note,
      actorUserId,
    },
  });
}

/** Create trackable units when an order is paid (one unit row per quantity). */
export async function createUnitsForPaidOrder(tx, order, orderItems) {
  const now = new Date();
  const created = [];

  for (const line of orderItems) {
    for (let i = 0; i < line.quantity; i += 1) {
      const unitSku = unitSkuFromOrder(order.publicId, line.id, i + 1);
      const unit = await tx.productUnit.create({
        data: {
          unitSku,
          productId: line.productId,
          productVariantId: line.productVariantId,
          status: 'SOLD',
          sourceOrderItemId: line.id,
          purchasedAt: now,
          soldAt: now,
        },
      });
      await recordUnitEvent(tx, unit.id, null, 'SOLD', `Order ${order.orderNumber || order.publicId}`);
      created.push(unit);
    }
  }
  return created;
}

export async function transitionUnitStatus(unitPublicId, toStatus, { note, actorUserId, dates = {} } = {}) {
  return prisma.$transaction(async (tx) => {
    const unit = await tx.productUnit.findUnique({ where: { publicId: unitPublicId } });
    if (!unit) return null;
    const fromStatus = unit.status;
    const data = { status: toStatus, ...dates };
    const updated = await tx.productUnit.update({
      where: { id: unit.id },
      data,
    });
    await recordUnitEvent(tx, unit.id, fromStatus, toStatus, note, actorUserId);
    return updated;
  });
}

export async function markUnitsReturnedForReturn(tx, returnRequestId) {
  const rr = await tx.returnRequest.findUnique({
    where: { id: returnRequestId },
    include: { orderItem: true },
  });
  if (!rr?.orderItemId) return [];

  const units = await tx.productUnit.findMany({
    where: { sourceOrderItemId: rr.orderItemId, status: { in: ['SOLD', 'WITH_CUSTOMER'] } },
    take: rr.orderItem?.quantity ?? 10,
  });

  const now = new Date();
  for (const unit of units) {
    await tx.productUnit.update({
      where: { id: unit.id },
      data: { status: 'RETURNED', returnedAt: now, sourceReturnId: returnRequestId },
    });
    await recordUnitEvent(tx, unit.id, unit.status, 'RETURNED', 'Return received');
  }
  return units;
}
