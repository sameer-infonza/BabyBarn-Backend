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
