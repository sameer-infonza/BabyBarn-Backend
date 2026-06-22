/** Refurbishment program configuration — override via environment. */
export const REFURB_STORE_CREDIT_RATE = Number(process.env.REFURB_STORE_CREDIT_RATE ?? 0.2);

/** ACCESS members can return used items for store credit within this window. */
export const ACCESS_USED_RETURN_WINDOW_DAYS = Number(process.env.ACCESS_USED_RETURN_WINDOW_DAYS ?? 365);

/** Flat store credit — grade multipliers removed per platform policy. */
export function computeRefurbStoreCredit(itemAccessPrice) {
  const base = Number(itemAccessPrice) || 0;
  return Math.round(base * REFURB_STORE_CREDIT_RATE * 100) / 100;
}
