/**
 * Customer self-service order cancellation rules.
 *
 * Customers may cancel while the warehouse has not started processing the order.
 * See backend/docs/customer-order-cancellation.md for the full flow.
 */

const TERMINAL_ORDER_STATUSES = new Set(['CANCELLED', 'SHIPPED', 'DELIVERED', 'RETURNED', 'REFUNDED']);

/** Fulfillment stages where cancellation is no longer allowed. */
const BLOCKED_FULFILLMENT_STATUSES = new Set([
  'ACCEPTED',
  'PICKUP_READY',
  'LABEL_GENERATED',
  'SHIPPED',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
]);

export function canCustomerCancelOrder(order) {
  if (!order) return false;

  const status = String(order.status || '').toUpperCase();
  if (TERMINAL_ORDER_STATUSES.has(status)) return false;
  if (order.deliveredAt) return false;

  const fulfillment = order.fulfillmentStatus
    ? String(order.fulfillmentStatus).toUpperCase()
    : null;
  if (fulfillment && fulfillment !== 'NEW_ORDER') return false;

  if (String(order.cancellationReviewStatus || '').toUpperCase() === 'PENDING') return false;

  const items = order.orderItems;
  if (Array.isArray(items) && items.length > 0 && items.every((line) => line.cancelledAt)) {
    return false;
  }

  return true;
}

export function customerCancelUnavailableReason(order) {
  if (!order) return 'Order not found.';
  if (String(order.cancellationReviewStatus || '').toUpperCase() === 'PENDING') {
    return 'A cancellation request is already being reviewed.';
  }

  const status = String(order.status || '').toUpperCase();
  if (TERMINAL_ORDER_STATUSES.has(status) || order.deliveredAt) {
    return 'This order can no longer be cancelled online.';
  }

  const fulfillment = order.fulfillmentStatus
    ? String(order.fulfillmentStatus).toUpperCase()
    : null;
  if (fulfillment && BLOCKED_FULFILLMENT_STATUSES.has(fulfillment)) {
    return 'Warehouse processing has already started, so this order can no longer be cancelled online.';
  }

  return 'This order can no longer be cancelled online.';
}
