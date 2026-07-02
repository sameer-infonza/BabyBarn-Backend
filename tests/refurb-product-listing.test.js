import test from 'node:test';
import assert from 'node:assert/strict';
import { refurbVariantSku, refurbPriceFrom } from '../services/refurb-product-listing.service.js';

test('refurbVariantSku appends RF suffix', () => {
  assert.equal(refurbVariantSku('BB-001-S'), 'BB-001-S-RF');
});

test('refurbPriceFrom applies 15% member discount floor', () => {
  assert.equal(refurbPriceFrom(100), 85);
  assert.equal(refurbPriceFrom(null), null);
});
