/**
 * Strip internal numeric ids from API JSON; expose `publicId` as `id` for clients.
 * Removes integer FK columns (joins use these server-side only).
 * Recurses into arrays and plain objects (Prisma includes).
 */

const INTERNAL_FK_KEYS = new Set([
  'userId',
  'roleId',
  'categoryId',
  'productId',
  'orderId',
]);

export function toPublicJson(value) {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => toPublicJson(item));
  if (typeof value !== 'object') return value;

  if (
    typeof value.publicId === 'string' &&
    Object.prototype.hasOwnProperty.call(value, 'id') &&
    typeof value.id === 'number'
  ) {
    const { id: _internalId, publicId, ...rest } = value;
    const mapped = {};
    for (const [k, v] of Object.entries(rest)) {
      if (INTERNAL_FK_KEYS.has(k) && typeof v === 'number') {
        continue;
      }
      mapped[k] = toPublicJson(v);
    }
    mapped.id = publicId;
    return mapped;
  }

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = toPublicJson(v);
  }
  return out;
}
