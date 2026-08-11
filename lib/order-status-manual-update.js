import { AppError } from '../utils/error-handler.js';

/**
 * ORD-001 Phase 2 — free-form Order.status mutation is not an operational control.
 * Domain actions own payment / fulfillment / returns / cancellation.
 *
 * Only CANCELLED remains on PATCH /orders/:id/status, and it must run the
 * cancellation workflow (finalizeOrderCancellation), not a bare status write.
 */

export const ORDER_STATUS_MANUAL_UPDATE_NOT_ALLOWED = 'ORDER_STATUS_MANUAL_UPDATE_NOT_ALLOWED';

/** @type {Record<string, { message: string; useInstead: string }>} */
export const MANUAL_ORDER_STATUS_REJECTIONS = {
  PENDING: {
    message:
      'PENDING is set by unpaid checkout. Manual Order.status updates are not allowed.',
    useInstead: 'Create or expire a pending checkout order through the payment lifecycle.',
  },
  PROCESSING: {
    message:
      'PROCESSING is set when payment succeeds. Manual Order.status updates are not allowed.',
    useInstead: 'Complete payment; the order becomes PROCESSING automatically.',
  },
  CONFIRMED: {
    message:
      'CONFIRMED is not an operational state. Manual Order.status updates are not allowed.',
    useInstead: 'Use fulfillment actions (pick / mark shipped / mark delivered).',
  },
  SHIPPED: {
    message:
      'Cannot set Order.status to SHIPPED manually. Use the fulfillment ship action.',
    useInstead: 'PATCH /orders/admin/:id/fulfillment with action "mark_shipped".',
  },
  DELIVERED: {
    message:
      'Cannot set Order.status to DELIVERED manually. Use the fulfillment deliver action.',
    useInstead: 'PATCH /orders/admin/:id/fulfillment with action "mark_delivered".',
  },
  RETURNED: {
    message:
      'Cannot set Order.status to RETURNED. Returns are tracked on ReturnRequest.',
    useInstead: 'Use the returns / inspection APIs for return lifecycle.',
  },
  REFUNDED: {
    message:
      'Cannot set Order.status to REFUNDED manually. Use the refund action.',
    useInstead: 'PATCH /orders/:id/refund.',
  },
};

/**
 * @param {string} status
 * @returns {never}
 */
export function rejectManualOrderStatusUpdate(status) {
  const key = String(status || '').toUpperCase();
  const guidance = MANUAL_ORDER_STATUS_REJECTIONS[key] || {
    message: `Manual Order.status update to ${key || '(empty)'} is not allowed.`,
    useInstead: 'Use fulfillment, cancel, or refund domain actions.',
  };
  throw new AppError(400, guidance.message, ORDER_STATUS_MANUAL_UPDATE_NOT_ALLOWED, {
    requestedStatus: key || null,
    useInstead: guidance.useInstead,
  });
}

/**
 * @param {string} status
 * @returns {'cancel' | 'reject'}
 */
export function classifyManualOrderStatusRequest(status) {
  const key = String(status || '').toUpperCase();
  if (key === 'CANCELLED') return 'cancel';
  return 'reject';
}
