import { config } from '../config/env.js';

/** Merchandise subtotal (before shipping/tax/access fee) qualifies for free shipping. */
export function qualifiesForFreeShipping(subtotal) {
  const threshold = Number(config.freeShippingThresholdUsd ?? 75);
  return Number(subtotal || 0) >= threshold;
}

/** Zero shipping when subtotal meets the configured threshold; otherwise return quoted cost. */
export function applyFreeShippingWaiver(subtotal, shippingCost) {
  const quoted = Math.max(0, Number(shippingCost || 0));
  if (quoted === 0) return 0;
  if (qualifiesForFreeShipping(subtotal)) return 0;
  return quoted;
}
