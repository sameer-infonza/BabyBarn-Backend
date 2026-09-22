import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCode128Png } from '../lib/code128.js';
import { newBarcodeCode } from '../lib/barcode-code.js';

test('Code 128 PNG encodes a BBP code', async () => {
  const buf = await renderCode128Png(newBarcodeCode());
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 80);
  assert.equal(buf[0], 0x89);
  assert.equal(buf[1], 0x50);
});
