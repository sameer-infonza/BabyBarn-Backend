/** Refurbishment program configuration — override via environment. */
export const REFURB_STORE_CREDIT_RATE = Number(process.env.REFURB_STORE_CREDIT_RATE ?? 0.2);

/** Default days until admin expects to receive a refurb return (USPS), from tracking or envelope sent. */
export const REFURB_SHIP_DEADLINE_DAYS = Number(process.env.REFURB_SHIP_DEADLINE_DAYS ?? 10);

/** @param {Date|string} [from] anchor — customer USPS submission or outbound envelope dispatch */
export function refurbShipByDeadline(from = new Date()) {
  const base = from instanceof Date ? from : new Date(from);
  return new Date(base.getTime() + REFURB_SHIP_DEADLINE_DAYS * 24 * 60 * 60 * 1000);
}

/** Alias for admin SLA copy — same configurable window as refurbShipByDeadline. */
export const refurbExpectedReceiveDeadline = refurbShipByDeadline;

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
