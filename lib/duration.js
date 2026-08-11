/**
 * Parse duration strings used by JWT/env config (e.g. 15m, 7d, 30d, 3600s).
 * @param {string | undefined | null} value
 * @param {number} fallbackMs
 * @returns {number}
 */
export function parseDurationToMs(value, fallbackMs) {
  const raw = String(value ?? '').trim();
  if (!raw) return fallbackMs;
  const match = /^(\d+)\s*(ms|s|m|h|d)$/i.exec(raw);
  if (!match) return fallbackMs;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) return fallbackMs;
  const unit = match[2].toLowerCase();
  const mult = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return amount * mult[unit];
}
