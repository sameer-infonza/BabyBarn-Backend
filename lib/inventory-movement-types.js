/**
 * Inventory movement vocabulary — extension layer for future WMS integration.
 * No warehouse tables yet; ledger events remain the source of truth.
 *
 * Future hook: attach `warehouseLocationId` (or bin metadata) on
 * `InventoryLedgerEvent.metadata` without a schema migration today.
 */

/** @typedef {'IN' | 'OUT' | 'ADJUST' | 'TRANSFER' | 'RESERVE' | 'COMMIT'} InventoryMovementType */

/** @type {Record<string, InventoryMovementType>} */
export const LEDGER_EVENT_TO_MOVEMENT = {
  IN: 'IN',
  OUT: 'OUT',
  ADJUST: 'ADJUST',
  TRANSFER: 'TRANSFER',
  RESERVE: 'RESERVE',
  COMMIT: 'COMMIT',
};

/** @type {Record<string, string>} */
export const REFERENCE_TYPE_LABELS = {
  refurbishment_job: 'Refurb listing',
  order: 'Order fulfillment',
  return: 'Return intake',
  manual_adjustment: 'Manual adjustment',
  admin_adjust: 'Admin adjustment',
};

/**
 * Resolve movement type from ledger row.
 * @param {string | null | undefined} eventType
 * @param {number} quantityChange
 * @returns {InventoryMovementType}
 */
export function movementTypeFromLedger(eventType, quantityChange) {
  if (eventType) {
    const key = String(eventType).toUpperCase();
    if (LEDGER_EVENT_TO_MOVEMENT[key]) return LEDGER_EVENT_TO_MOVEMENT[key];
  }
  if (quantityChange > 0) return 'IN';
  if (quantityChange < 0) return 'OUT';
  return 'ADJUST';
}

/**
 * @param {string | null | undefined} referenceType
 * @param {string | null | undefined} referenceId
 */
export function formatLedgerReference(referenceType, referenceId) {
  if (!referenceType) return null;
  const label = REFERENCE_TYPE_LABELS[referenceType] ?? referenceType;
  const id = referenceId ? String(referenceId).trim() : '';
  return id ? `${label}:${id}` : label;
}
