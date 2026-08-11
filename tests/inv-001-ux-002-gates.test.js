import test from 'node:test';
import assert from 'node:assert/strict';
import { inventoryAdjustSchema, orderFulfillmentActionSchema } from '../schemas/index.js';

test('INV-001: inventory adjust requires reason ≥3 chars', () => {
  const missing = inventoryAdjustSchema.safeParse({
    productId: 'prod_1',
    delta: 1,
  });
  assert.equal(missing.success, false);

  const short = inventoryAdjustSchema.safeParse({
    productId: 'prod_1',
    delta: 1,
    reason: 'ab',
  });
  assert.equal(short.success, false);

  const ok = inventoryAdjustSchema.safeParse({
    productId: 'prod_1',
    delta: -2,
    reason: 'Cycle count correction',
  });
  assert.equal(ok.success, true);
});

test('UX-002: mark_shipped accepts optional shipOverrideReason', () => {
  const base = orderFulfillmentActionSchema.safeParse({ action: 'mark_shipped' });
  assert.equal(base.success, true);

  const withOverride = orderFulfillmentActionSchema.safeParse({
    action: 'mark_shipped',
    shipOverrideReason: 'Carrier handed off without label',
  });
  assert.equal(withOverride.success, true);

  const tooShort = orderFulfillmentActionSchema.safeParse({
    action: 'mark_shipped',
    shipOverrideReason: 'no',
  });
  assert.equal(tooShort.success, false);
});
