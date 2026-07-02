import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOrderLinePricing } from '../services/order.service.js';

test('buildOrderLinePricing marks ACCESS when member price applies', () => {
  const product = { price: 100, memberPrice: 70 };
  const line = buildOrderLinePricing(product, null, true);
  assert.equal(line.pricingTier, 'ACCESS');
  assert.equal(line.price, 70);
  assert.equal(line.retailUnitPrice, 100);
});

test('buildOrderLinePricing stays STANDARD without member eligibility', () => {
  const product = { price: 100, memberPrice: 70 };
  const line = buildOrderLinePricing(product, null, false);
  assert.equal(line.pricingTier, 'STANDARD');
  assert.equal(line.price, 100);
});

test('buildOrderLinePricing stays STANDARD when no member price on product', () => {
  const product = { price: 100, memberPrice: null };
  const line = buildOrderLinePricing(product, null, true);
  assert.equal(line.pricingTier, 'STANDARD');
  assert.equal(line.price, 100);
});

test('buildOrderLinePricing uses variant member price override', () => {
  const product = { price: 100, memberPrice: 70 };
  const variant = { priceOverride: 90, memberPriceOverride: 55 };
  const line = buildOrderLinePricing(product, variant, true);
  assert.equal(line.pricingTier, 'ACCESS');
  assert.equal(line.price, 55);
  assert.equal(line.retailUnitPrice, 90);
  assert.equal(line.memberPriceSnapshot, 55);
});
