/** Refurbishment program configuration — override via environment. */
export const REFURB_STORE_CREDIT_RATE = Number(process.env.REFURB_STORE_CREDIT_RATE ?? 0.2);

/** Default when BusinessSettings row is unset (env override). */
export const ACCESS_USED_RETURN_WINDOW_DAYS = Number(process.env.ACCESS_USED_RETURN_WINDOW_DAYS ?? 365);

/** Resolve used-return window from admin settings with env/default fallback. */
export async function getAccessUsedReturnWindowDays() {
  const { getBusinessSettings } = await import('../services/admin.service.js');
  const settings = await getBusinessSettings();
  const fromDb = settings.accessUsedReturnWindowDays;
  if (fromDb != null && Number.isFinite(Number(fromDb)) && Number(fromDb) > 0) {
    return Math.floor(Number(fromDb));
  }
  return ACCESS_USED_RETURN_WINDOW_DAYS;
}

/** Flat store credit — grade multipliers removed per platform policy. */
export function computeRefurbStoreCredit(itemAccessPrice) {
  const base = Number(itemAccessPrice) || 0;
  return Math.round(base * REFURB_STORE_CREDIT_RATE * 100) / 100;
}
