import { prisma } from '../lib/prisma.js';
import { restockOrderLineStock } from './inventory-reservation.js';

/** Restore stock for all lines on a paid order (full refund / cancellation restock). */
export async function restockPaidOrder(orderPublicId, ledgerCtx = {}) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { publicId: orderPublicId },
      include: { orderItems: true },
    });
    if (!order) return { restocked: 0 };

    const ctx = {
      referenceType: ledgerCtx.referenceType || 'order',
      referenceId: orderPublicId,
      actorUserId: ledgerCtx.actorUserId ?? null,
      note: ledgerCtx.note ?? 'Order refund restock',
    };

    let restocked = 0;
    for (const line of order.orderItems) {
      if (line.cancelledAt) continue;
      const product = await tx.product.findUnique({
        where: { id: line.productId },
        include: { variants: { orderBy: { sortOrder: 'asc' } } },
      });
      if (!product) continue;
      await restockOrderLineStock(
        tx,
        product,
        line.productVariantId,
        line.quantity,
        ctx,
        'REFUND_RESTORE'
      );
      restocked += line.quantity;
    }
    return { restocked };
  });
}

/**
 * Restock paid-order lines. Skips already-cancelled lines.
 * Pass `itemPublicIds` to restock only those lines (partial cancellation).
 */
export async function restockPaidOrderInTx(tx, order, ledgerCtx = {}) {
  const ctx = {
    referenceType: ledgerCtx.referenceType || 'order',
    referenceId: order.publicId,
    actorUserId: ledgerCtx.actorUserId ?? null,
    note: ledgerCtx.note ?? null,
  };
  const filterIds = Array.isArray(ledgerCtx.itemPublicIds)
    ? new Set(ledgerCtx.itemPublicIds.map(String))
    : null;
  let restocked = 0;
  for (const line of order.orderItems) {
    if (line.cancelledAt) continue;
    if (filterIds && !filterIds.has(String(line.publicId))) continue;
    const product = await tx.product.findUnique({
      where: { id: line.productId },
      include: { variants: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!product) continue;
    await restockOrderLineStock(
      tx,
      product,
      line.productVariantId,
      line.quantity,
      ctx,
      ledgerCtx.eventType || 'REFUND_RESTORE'
    );
    restocked += line.quantity;
  }
  return { restocked };
}
