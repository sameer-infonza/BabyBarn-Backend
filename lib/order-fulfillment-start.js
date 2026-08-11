/**
 * ORD-001 Phase 1 — canonical post-payment fulfillment start.
 *
 * Paid orders auto-accept into the warehouse pipeline. There is no separate
 * admin Accept step. Cancel window starts at fulfillmentAcceptedAt.
 *
 * @param {Date} [at]
 * @returns {{ fulfillmentStatus: 'ACCEPTED'; fulfillmentAcceptedAt: Date }}
 */
export function postPaymentFulfillmentFields(at = new Date()) {
  return {
    fulfillmentStatus: 'ACCEPTED',
    fulfillmentAcceptedAt: at,
  };
}
