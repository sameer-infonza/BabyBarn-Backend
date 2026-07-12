/** Return statuses that free the line for a new return attempt (rejection only). */
export const TERMINAL_RETURN_REJECT_STATUSES = new Set([
  'REJECTED',
  'ELIGIBILITY_REJECTED',
  'INSPECTION_REJECTED',
  'CANCELLED',
]);

/**
 * Sum units already tied to non-rejected returns on a line (in-flight or completed).
 * @param {Array<{ status: string; quantity?: number | null }>} returns
 */
export function claimedReturnQuantity(returns = []) {
  return returns
    .filter((r) => !TERMINAL_RETURN_REJECT_STATUSES.has(String(r.status || '').toUpperCase()))
    .reduce((sum, r) => sum + Math.max(1, Number(r.quantity) || 1), 0);
}

/**
 * @param {{ quantity?: number | null; returnRequests?: Array<{ status: string; quantity?: number | null }> }} orderItem
 */
export function returnableQuantityForLine(orderItem) {
  const purchased = Math.max(1, Number(orderItem?.quantity) || 1);
  const claimed = claimedReturnQuantity(orderItem?.returnRequests ?? []);
  return Math.max(0, purchased - claimed);
}

/**
 * @param {Array<{ status: string; quantity?: number | null; publicId?: string }>} returns
 */
export function openReturnsForLine(returns = []) {
  return returns.filter((r) => !TERMINAL_RETURN_REJECT_STATUSES.has(String(r.status || '').toUpperCase()));
}
