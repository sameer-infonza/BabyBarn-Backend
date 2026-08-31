import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyFreeShippingWaiver,
  qualifiesForFreeShipping,
} from '../lib/free-shipping.js';
import { config } from '../config/env.js';

test('qualifiesForFreeShipping at threshold', () => {
  const threshold = config.freeShippingThresholdUsd;
  assert.equal(qualifiesForFreeShipping(threshold), true);
  assert.equal(qualifiesForFreeShipping(threshold - 0.01), false);
});

test('applyFreeShippingWaiver waives shipping when subtotal qualifies', () => {
  assert.equal(applyFreeShippingWaiver(80, 12.5), 0);
});

test('applyFreeShippingWaiver keeps quoted shipping below threshold', () => {
  assert.equal(applyFreeShippingWaiver(50, 12.5), 12.5);
});

test('applyFreeShippingWaiver leaves zero shipping unchanged', () => {
  assert.equal(applyFreeShippingWaiver(100, 0), 0);
});
