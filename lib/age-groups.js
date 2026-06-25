/**
 * Canonical child age groups, shared across product validation, listing filters,
 * and the variant Age axis. Order here defines the display/sort order everywhere.
 */
export const AGE_GROUPS = ['0-3M', '3-6M', '6-9M', '9-12M', '12-18M', '18-24M'];

/** The variant combination key that carries the age group. */
export const AGE_AXIS_NAME = 'Age';

const AGE_INDEX = new Map(AGE_GROUPS.map((v, i) => [v, i]));

export function isCanonicalAge(value) {
  return typeof value === 'string' && AGE_INDEX.has(value.trim());
}

/** Sort index for an age value; unknown values sort last. */
export function ageOrderIndex(value) {
  const i = AGE_INDEX.get(typeof value === 'string' ? value.trim() : value);
  return i === undefined ? Number.MAX_SAFE_INTEGER : i;
}

/** True when a variant combination axis key represents the age group. */
export function isAgeAxisKey(key) {
  if (typeof key !== 'string') return false;
  const k = key.trim();
  return k === AGE_AXIS_NAME || /age/i.test(k);
}
