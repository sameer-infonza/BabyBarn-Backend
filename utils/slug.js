/**
 * URL-safe slug from a display name (ASCII-ish); falls back if empty.
 */
export function slugifyName(name) {
  const base = String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base.length > 0 ? base : 'product';
}
