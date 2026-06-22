import { AppError } from '../utils/error-handler.js';

/** Fallback when product has no par level set. */
export const DEFAULT_LOW_STOCK_THRESHOLD = parseInt(process.env.LOW_STOCK_THRESHOLD || '10', 10);

/** NEW listings require at least this many available units to sell. */
export const NEW_MIN_SELLABLE_UNITS = 3;

/** The per-product reorder point is itself the low-stock threshold. */
export function lowStockThresholdFromPar(reorderPoint) {
  const par = Number(reorderPoint);
  if (!Number.isFinite(par) || par <= 0) return DEFAULT_LOW_STOCK_THRESHOLD;
  return Math.max(1, Math.floor(par));
}

export function minSellableUnits(productType) {
  return productType === 'REFURBISHED' ? 1 : NEW_MIN_SELLABLE_UNITS;
}

export function isSellableAvailable(available, productType = 'NEW') {
  const n = Number(available) || 0;
  if (n <= 0) return false;
  if (productType !== 'REFURBISHED' && n < NEW_MIN_SELLABLE_UNITS) return false;
  return true;
}

export function stockStatusFromAvailable(available, reorderPoint, productType = 'NEW') {
  const n = Number(available) || 0;
  if (n <= 0) return 'out_of_stock';
  if (productType !== 'REFURBISHED' && n < NEW_MIN_SELLABLE_UNITS) return 'out_of_stock';
  const threshold = lowStockThresholdFromPar(reorderPoint);
  if (n <= threshold) return 'low_stock';
  return 'in_stock';
}

export function assertSellableStock(product, quantity) {
  const available =
    product.variants?.length > 0
      ? product.variants.reduce((s, v) => s + Math.max(0, (v.stock ?? 0) - (v.reservedStock ?? 0)), 0)
      : Math.max(0, (product.stock ?? 0) - (product.reservedStock ?? 0));

  if (!isSellableAvailable(available, product.productType)) {
    throw new AppError(400, `"${product.name}" is out of stock`);
  }
  if (available < quantity) {
    throw new AppError(400, `Insufficient stock for "${product.name}"`);
  }
}
