import { randomUUID } from 'crypto';

/** Human-readable order reference shown to customers and admins (not the DB primary key). */

/** Unique placeholder until assignOrderNumber runs (required NOT NULL column at insert). */
export function placeholderOrderNumber() {
  return `PENDING-${randomUUID()}`;
}

export function formatOrderNumber(internalOrderId) {
  const n = Number(internalOrderId);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error('Invalid internal order id for order number');
  }
  return `BB-${String(Math.floor(n)).padStart(6, '0')}`;
}

/** Assign orderNumber after insert; safe inside a transaction. */
export async function assignOrderNumber(tx, orderDbId) {
  const orderNumber = formatOrderNumber(orderDbId);
  return tx.order.update({
    where: { id: orderDbId },
    data: { orderNumber },
  });
}
