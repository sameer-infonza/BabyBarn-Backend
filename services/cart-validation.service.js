/**
 * Shared cart line validation for quote, checkout intent, cart page, and buy-again.
 * Supports sanitize mode (drop invalid / clamp qty) and strict mode (throw on first error).
 */
import { AppError } from '../utils/error-handler.js';
import { refreshPrismaClientIfNeeded } from '../lib/prisma.js';
import { isSellableAvailable } from '../lib/inventory-stock-rules.js';
import {
  productAvailableStock,
  variantAvailableStock,
} from './inventory-reservation.js';

function db() {
  return refreshPrismaClientIfNeeded();
}

/**
 * @typedef {{ productId: string, quantity: number, variantId?: string | null, name?: string | null }} CartInputLine
 * @typedef {{
 *   code: string,
 *   reason: string,
 *   productId: string,
 *   variantId?: string | null,
 *   name?: string | null,
 *   requestedQuantity?: number,
 *   availableQuantity?: number,
 * }} CartIssue
 * @typedef {{
 *   productId: string,
 *   variantId: string | null,
 *   quantity: number,
 *   name: string,
 *   maxQuantity: number,
 *   available: number,
 *   condition: string,
 *   imageUrl?: string | null,
 *   sizeAgeGroup?: string | null,
 *   retailUnitPrice: number,
 *   memberPrice: number | null,
 * }} CartValidLine
 */

function displayName(product, fallback) {
  return product?.name || fallback || 'This product';
}

function combinationHint(variant) {
  if (!variant?.combination || typeof variant.combination !== 'object') return '';
  const parts = Object.entries(variant.combination)
    .filter(([, v]) => v != null && String(v).trim())
    .map(([k, v]) => `${k}: ${v}`);
  return parts.length ? parts.join(', ') : '';
}

/**
 * Validate cart lines against live catalog + inventory.
 * @param {CartInputLine[]} inputItems
 * @param {{ mode?: 'sanitize' | 'strict' }} [opts]
 */
export async function validateCartLines(inputItems, opts = {}) {
  const mode = opts.mode === 'strict' ? 'strict' : 'sanitize';
  const items = Array.isArray(inputItems) ? inputItems : [];
  /** @type {CartValidLine[]} */
  const validItems = [];
  /** @type {CartIssue[]} */
  const removed = [];
  /** @type {CartIssue[]} */
  const adjusted = [];

  const failOrRemove = (issue) => {
    if (mode === 'strict') {
      throw new AppError(400, issue.reason, issue.code, {
        productId: issue.productId,
        variantId: issue.variantId ?? null,
      });
    }
    removed.push(issue);
  };

  for (const raw of items) {
    const productId = String(raw?.productId || '').trim();
    const variantId = raw?.variantId ? String(raw.variantId).trim() : null;
    const requestedQty = Math.max(1, Number(raw?.quantity) || 1);
    const fallbackName = raw?.name ? String(raw.name) : null;

    if (!productId) {
      failOrRemove({
        code: 'PRODUCT_REQUIRED',
        reason: 'A product is missing from your cart.',
        productId: '',
        variantId,
        name: fallbackName,
        requestedQuantity: requestedQty,
      });
      continue;
    }

    const product = await db().product.findUnique({
      where: { publicId: productId },
      include: { variants: { orderBy: { sortOrder: 'asc' } } },
    });

    if (!product) {
      failOrRemove({
        code: 'PRODUCT_NOT_FOUND',
        reason: fallbackName
          ? `"${fallbackName}" is no longer available.`
          : 'A product in your cart is no longer available.',
        productId,
        variantId,
        name: fallbackName,
        requestedQuantity: requestedQty,
      });
      continue;
    }

    const name = displayName(product, fallbackName);

    if (product.isDraft || !product.isActiveListing) {
      failOrRemove({
        code: 'PRODUCT_UNAVAILABLE',
        reason: product.isDraft
          ? `"${name}" has been unpublished and was removed from your cart.`
          : `"${name}" is not available for sale and was removed from your cart.`,
        productId,
        variantId,
        name,
        requestedQuantity: requestedQty,
      });
      continue;
    }

    const variants = product.variants ?? [];
    let variant = null;

    if (variants.length > 0) {
      if (!variantId) {
        failOrRemove({
          code: 'VARIANT_REQUIRED',
          reason: `Select a size or color for "${name}".`,
          productId,
          variantId: null,
          name,
          requestedQuantity: requestedQty,
        });
        continue;
      }
      variant = variants.find((v) => v.publicId === variantId) || null;
      if (!variant) {
        failOrRemove({
          code: 'VARIANT_NOT_FOUND',
          reason: `The selected option for "${name}" is no longer available.`,
          productId,
          variantId,
          name,
          requestedQuantity: requestedQty,
        });
        continue;
      }
    } else if (variantId) {
      // Stale variant id on a simple product — ignore and sell at product level.
      variant = null;
    }

    const available = variant
      ? variantAvailableStock(variant)
      : productAvailableStock(product);

    if (!isSellableAvailable(available, product.productType)) {
      const hint = combinationHint(variant);
      failOrRemove({
        code: 'OUT_OF_STOCK',
        reason: hint
          ? `"${name}" (${hint}) is out of stock and was removed from your cart.`
          : `"${name}" is out of stock and was removed from your cart.`,
        productId,
        variantId: variant?.publicId || null,
        name,
        requestedQuantity: requestedQty,
        availableQuantity: available,
      });
      continue;
    }

    let quantity = requestedQty;
    if (available < requestedQty) {
      if (mode === 'strict') {
        throw new AppError(
          400,
          `Only ${available} of "${name}" available (you requested ${requestedQty}).`,
          'INSUFFICIENT_STOCK',
          { productId, variantId: variant?.publicId || null, available }
        );
      }
      quantity = Math.max(1, available);
      adjusted.push({
        code: 'QUANTITY_ADJUSTED',
        reason: `"${name}" quantity updated from ${requestedQty} to ${quantity} (available stock).`,
        productId,
        variantId: variant?.publicId || null,
        name,
        requestedQuantity: requestedQty,
        availableQuantity: available,
      });
    }

    const retail =
      variant?.price != null && Number(variant.price) > 0
        ? Number(variant.price)
        : Number(product.price || 0);
    const member =
      variant?.memberPrice != null
        ? Number(variant.memberPrice)
        : product.memberPrice != null
          ? Number(product.memberPrice)
          : null;

    validItems.push({
      productId: product.publicId,
      variantId: variant?.publicId || null,
      quantity,
      name,
      maxQuantity: available,
      available,
      condition: product.productType === 'REFURBISHED' ? 'REFURBISHED' : 'NEW',
      imageUrl: variant?.imageUrl || product.imageUrl || null,
      sizeAgeGroup:
        (variant?.combination &&
          (variant.combination.size ||
            variant.combination.Size ||
            variant.combination.age ||
            variant.combination.Age)) ||
        product.sizeAgeGroup ||
        null,
      retailUnitPrice: retail,
      memberPrice: member,
    });
  }

  const summary = buildCartValidationSummary(validItems, removed, adjusted);

  return {
    ok: validItems.length > 0,
    items: validItems,
    removed,
    adjusted,
    summary,
  };
}

export function buildCartValidationSummary(validItems, removed, adjusted) {
  const parts = [];
  if (validItems.length > 0 && (removed.length > 0 || adjusted.length > 0)) {
    parts.push(
      `${validItems.length} item${validItems.length === 1 ? '' : 's'} available for checkout.`
    );
  }
  for (const r of removed) {
    parts.push(r.reason);
  }
  for (const a of adjusted) {
    parts.push(a.reason);
  }
  if (!validItems.length && removed.length) {
    return removed.map((r) => r.reason).join(' ') || 'No items in your cart are available.';
  }
  return parts.length ? parts.join(' ') : null;
}

/**
 * Map sanitized lines back to checkout API item shape.
 * @param {CartValidLine[]} validItems
 */
export function toCheckoutItems(validItems) {
  return validItems.map((line) => ({
    productId: line.productId,
    quantity: line.quantity,
    ...(line.variantId ? { variantId: line.variantId } : {}),
  }));
}
