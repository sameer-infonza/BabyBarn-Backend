/**
 * Customer self-service order cancellation rules.
 *
 * After payment, orders are auto-accepted. Customers may cancel for 60 minutes
 * from acceptance (payment success), unless warehouse packing has started
 * (PICKUP_READY+) or the order is terminal. See backend/docs/customer-order-cancellation.md.
 */

export const CUSTOMER_CANCEL_WINDOW_MS = 60 * 60 * 1000;

const TERMINAL_ORDER_STATUSES = new Set(['CANCELLED', 'SHIPPED', 'DELIVERED', 'RETURNED', 'REFUNDED']);

/** Fulfillment stages where cancellation is no longer allowed (warehouse packing started). */
const BLOCKED_FULFILLMENT_STATUSES = new Set([
  'PICKUP_READY',
  'LABEL_GENERATED',
  'SHIPPED',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
]);

/** Window start: fulfillmentAcceptedAt (set on payment auto-accept), else createdAt when paid. */
export function customerCancelWindowStart(order) {
  if (!order) return null;
  if (order.fulfillmentAcceptedAt) {
    const d = new Date(order.fulfillmentAcceptedAt);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const payment = String(order.paymentStatus || '').toUpperCase();
  if (payment === 'PAID' || payment === 'PARTIALLY_REFUNDED') {
    const d = new Date(order.createdAt || order.updatedAt);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function customerCancelWindowEndsAt(order) {
  const start = customerCancelWindowStart(order);
  if (!start) return null;
  return new Date(start.getTime() + CUSTOMER_CANCEL_WINDOW_MS);
}

export function customerCancelMsRemaining(order, now = Date.now()) {
  const ends = customerCancelWindowEndsAt(order);
  if (!ends) return 0;
  return Math.max(0, ends.getTime() - now);
}

export function isWithinCustomerCancelWindow(order, now = Date.now()) {
  return customerCancelMsRemaining(order, now) > 0;
}

export function canCustomerCancelOrder(order, now = Date.now()) {
  if (!order) return false;

  const status = String(order.status || '').toUpperCase();
  if (TERMINAL_ORDER_STATUSES.has(status)) return false;
  if (order.deliveredAt) return false;

  const fulfillment = order.fulfillmentStatus
    ? String(order.fulfillmentStatus).toUpperCase()
    : null;
  if (fulfillment && BLOCKED_FULFILLMENT_STATUSES.has(fulfillment)) return false;

  if (String(order.cancellationReviewStatus || '').toUpperCase() === 'PENDING') return false;

  if (!isWithinCustomerCancelWindow(order, now)) return false;

  const items = order.orderItems;
  if (Array.isArray(items) && items.length > 0 && items.every((line) => line.cancelledAt)) {
    return false;
  }

  return true;
}

export function customerCancelUnavailableReason(order, now = Date.now()) {
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

  if (!isWithinCustomerCancelWindow(order, now)) {
    return 'The 60-minute cancellation window has ended.';
  }

  return 'This order can no longer be cancelled online.';
}
