import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertNoMaterialCartChanges,
  hasMaterialCartChanges,
} from '../services/cart-validation.service.js';
import { AppError } from '../utils/error-handler.js';

test('CART-001: hasMaterialCartChanges detects removed and adjusted', () => {
  assert.equal(hasMaterialCartChanges({ removed: [], adjusted: [] }), false);
  assert.equal(hasMaterialCartChanges({ removed: [{ code: 'OUT_OF_STOCK' }], adjusted: [] }), true);
  assert.equal(
    hasMaterialCartChanges({ removed: [], adjusted: [{ code: 'QUANTITY_ADJUSTED' }] }),
    true
  );
  assert.equal(hasMaterialCartChanges(null), false);
  assert.equal(hasMaterialCartChanges(undefined), false);
});

test('CART-001: assertNoMaterialCartChanges is no-op when clean', () => {
  assert.doesNotThrow(() =>
    assertNoMaterialCartChanges({ removed: [], adjusted: [], items: [{ productId: 'p1' }] })
  );
});

test('CART-001: assertNoMaterialCartChanges throws CART_CHANGED on material change', () => {
  const items = [{ productId: 'p1', quantity: 1 }];
  try {
    assertNoMaterialCartChanges({
      summary: 'Qty updated',
      removed: [],
      adjusted: [{ code: 'QUANTITY_ADJUSTED', reason: 'clamped', productId: 'p1' }],
      items,
    });
    assert.fail('expected throw');
  } catch (err) {
    assert.ok(err instanceof AppError);
    assert.equal(err.code, 'CART_CHANGED');
    assert.equal(err.statusCode, 409);
    assert.equal(err.details.adjusted.length, 1);
    assert.equal(err.details.removed.length, 0);
    assert.deepEqual(err.details.items, items);
  }
});
