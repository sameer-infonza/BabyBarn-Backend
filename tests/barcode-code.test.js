import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BARCODE_PREFIX,
  barcodeTargetKey,
  isBarcodeCode,
  newBarcodeCode,
  normalizeBarcodeCode,
} from '../lib/barcode-code.js';

test('newBarcodeCode is BBP- plus 8 Crockford chars', () => {
  const code = newBarcodeCode();
  assert.match(code, /^BBP-[0-9A-HJKMNP-TV-Z]{8}$/);
  assert.ok(code.startsWith(BARCODE_PREFIX));
});

test('newBarcodeCode is not derived from a SKU', () => {
  const a = newBarcodeCode();
  const b = newBarcodeCode();
  assert.notEqual(a, b);
  assert.ok(!a.includes('SKU'));
});

test('isBarcodeCode rejects SKU-shaped values', () => {
  assert.equal(isBarcodeCode('BB-001-S'), false);
  assert.equal(isBarcodeCode('SKU-ABC'), false);
  assert.equal(isBarcodeCode(newBarcodeCode()), true);
});

test('normalizeBarcodeCode uppercases', () => {
  assert.equal(normalizeBarcodeCode('  bbp-a1b2c3d4  '), 'BBP-A1B2C3D4');
});

test('barcodeTargetKey distinguishes simple vs variant', () => {
  assert.equal(barcodeTargetKey({ productId: 9 }), 'p:9');
  assert.equal(barcodeTargetKey({ productId: 9, variantId: 3 }), 'v:3');
});
