/**
 * WS-A3 helpers — applied Stripe refund IDs on Order (JSON array).
 */

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
export function parseAppliedStripeRefundIds(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x || '').trim()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parseAppliedStripeRefundIds(parsed);
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * @param {unknown} raw
 * @param {string} stripeRefundId
 */
export function hasAppliedStripeRefundId(raw, stripeRefundId) {
  const id = String(stripeRefundId || '').trim();
  if (!id) return false;
  return parseAppliedStripeRefundIds(raw).includes(id);
}

/**
 * @param {unknown} raw
 * @param {string} stripeRefundId
 * @returns {string[]}
 */
export function appendAppliedStripeRefundId(raw, stripeRefundId) {
  const id = String(stripeRefundId || '').trim();
  const prev = parseAppliedStripeRefundIds(raw);
  if (!id || prev.includes(id)) return prev;
  return [...prev, id];
}

/** Deterministic wallet restore key for cancel credit restoration (not WAL-001 earn). */
export function cancelCreditRestoreSourceKey(orderPublicId, stripeRefundId) {
  const order = String(orderPublicId || '').trim() || 'unknown';
  const refund = String(stripeRefundId || '').trim() || 'norefund';
  return `restore:cancel:${order}:${refund}`.slice(0, 190);
}

/** Admin refund restore key when credit is restored (future); restock gate uses appliedStripeRefundIds. */
export function adminRefundSideEffectKey(orderPublicId, stripeRefundId) {
  const order = String(orderPublicId || '').trim() || 'unknown';
  const refund = String(stripeRefundId || '').trim() || 'norefund';
  return `restore:admin-refund:${order}:${refund}`.slice(0, 190);
}
