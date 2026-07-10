/** Human-readable return reference (SRT-/RRT-), not the API publicId. */

export function formatReturnNumber(type, internalId) {
  const n = Number(internalId);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error('Invalid internal return id for return number');
  }
  const prefix = String(type || '').toUpperCase() === 'REFURBISHMENT' ? 'RRT' : 'SRT';
  return `${prefix}-${String(Math.floor(n)).padStart(6, '0')}`;
}

/** Assign returnNumber after insert; safe inside a transaction. */
export async function assignReturnNumber(tx, returnDbId, type) {
  const returnNumber = formatReturnNumber(type, returnDbId);
  return tx.returnRequest.update({
    where: { id: returnDbId },
    data: { returnNumber },
  });
}
