/** Refurbishment program configuration — override via environment. */
export const REFURB_STORE_CREDIT_RATE = Number(process.env.REFURB_STORE_CREDIT_RATE ?? 0.2);

/** Flat store credit — grade multipliers removed per platform policy. */
export function computeRefurbStoreCredit(itemAccessPrice) {
  const base = Number(itemAccessPrice) || 0;
  return Math.round(base * REFURB_STORE_CREDIT_RATE * 100) / 100;
}
