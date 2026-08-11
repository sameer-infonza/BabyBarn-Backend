/**
 * ORD-001-P3 — shared manual-ship transition when attaching outbound tracking.
 *
 * Used by updateAdminShipping and addTracking so Order.status and
 * fulfillmentStatus cannot diverge on a ship transition.
 *
 * Does NOT apply to UPS label generation (tracking + PICKUP_READY without ship).
 */

const PRE_SHIP_ORDER_STATUSES = new Set(['PENDING', 'PROCESSING', 'CONFIRMED']);

/**
 * @param {string | null | undefined} status
 * @returns {boolean}
 */
export function isPreShipOrderStatus(status) {
  return PRE_SHIP_ORDER_STATUSES.has(String(status || '').toUpperCase());
}

/**
 * Whether attaching a tracking number should perform the manual ship transition.
 * Matches updateAdminShipping: requires a non-empty tracking number and a pre-ship Order.status.
 *
 * @param {{ status?: string | null, trackingNumber?: string | null }} args
 * @returns {boolean}
 */
export function shouldManualShipFromTracking({ status, trackingNumber }) {
  const tn = trackingNumber != null ? String(trackingNumber).trim() : '';
  return Boolean(tn) && isPreShipOrderStatus(status);
}

/**
 * Fields for an atomic ship transition (status + fulfillment + timestamp).
 * Call only when shouldManualShipFromTracking is true.
 *
 * @param {Date} [at]
 * @returns {{ status: 'SHIPPED', fulfillmentStatus: 'SHIPPED', outboundShippedAt: Date }}
 */
export function manualShipFromTrackingFields(at = new Date()) {
  return {
    status: 'SHIPPED',
    fulfillmentStatus: 'SHIPPED',
    outboundShippedAt: at,
  };
}
