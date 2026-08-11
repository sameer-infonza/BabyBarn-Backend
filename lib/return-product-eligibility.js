import { AppError } from '../utils/error-handler.js';

/**
 * Canonical product-condition eligibility for return workflows (BR-001).
 *
 * STANDARD and REFURBISHMENT both require non-refurbished (NEW) catalog lines.
 * Call this for every selected order line at create time. Do not use to
 * invalidate existing open returns.
 *
 * @param {{ returnType: string; productType?: string | null }} args
 */
export function assertOrderLineEligibleForReturnType({ returnType, productType }) {
  const type = String(returnType || 'STANDARD').toUpperCase();
  const condition = String(productType || 'NEW').toUpperCase();
  if (condition !== 'REFURBISHED') return;

  if (type === 'STANDARD') {
    throw new AppError(
      400,
      'Standard returns are only available for new products. Refurbished items cannot be returned through Standard Return.',
      'STANDARD_RETURN_REFURBISHED_NOT_ALLOWED'
    );
  }

  if (type === 'REFURBISHMENT') {
    throw new AppError(400, 'Return Used Product is only available for eligible new items');
  }
}

/**
 * @param {{ returnType: string; productType?: string | null }} args
 * @returns {boolean}
 */
export function isOrderLineEligibleForReturnType({ returnType, productType }) {
  try {
    assertOrderLineEligibleForReturnType({ returnType, productType });
    return true;
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 400) return false;
    throw err;
  }
}

/**
 * Reject the whole request if any selected line is ineligible (no silent drop / split).
 * @param {string} returnType
 * @param {Array<{ product?: { productType?: string | null } | null; productType?: string | null }>} lines
 */
export function assertSelectedOrderLinesEligibleForReturnType(returnType, lines = []) {
  for (const line of lines) {
    assertOrderLineEligibleForReturnType({
      returnType,
      productType: line?.product?.productType ?? line?.productType,
    });
  }
}
