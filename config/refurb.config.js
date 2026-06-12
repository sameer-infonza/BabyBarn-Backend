/** Refurbishment program configuration — override via environment. */
export const REFURB_STORE_CREDIT_RATE = Number(process.env.REFURB_STORE_CREDIT_RATE ?? 0.2);

/** Grade multipliers applied to base credit (A=100%, B=100%, C=80% by default). */
export const REFURB_GRADE_CREDIT_MULTIPLIERS = {
  A: Number(process.env.REFURB_CREDIT_GRADE_A ?? 1),
  B: Number(process.env.REFURB_CREDIT_GRADE_B ?? 1),
  C: Number(process.env.REFURB_CREDIT_GRADE_C ?? 0.8),
};

export function refurbCreditMultiplierForGrade(grade) {
  const key = String(grade || 'B').toUpperCase();
  const mult = REFURB_GRADE_CREDIT_MULTIPLIERS[key];
  return Number.isFinite(mult) && mult >= 0 ? mult : 1;
}
