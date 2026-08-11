import test from 'node:test';
import assert from 'node:assert/strict';
import { returnableQuantityForLine } from '../lib/return-quantity-policy.js';

/**
 * Simulates WS-A5: FOR UPDATE → recalculate returnable → create.
 */
function createLineStore(purchasedQty) {
  return {
    quantity: purchasedQty,
    cancelledAt: null,
    returns: [],
  };
}

function tryCreateReturn(line, requestedQty) {
  if (line.cancelledAt) {
    return { ok: false, code: 'ORDER_ITEM_CANCELLED' };
  }
  const returnable = returnableQuantityForLine({
    quantity: line.quantity,
    cancelledAt: line.cancelledAt,
    returnRequests: line.returns,
  });
  if (requestedQty > returnable) {
    return { ok: false, code: returnable <= 0 ? 'RETURN_ALREADY_OPEN' : 'RETURN_QUANTITY_EXCEEDED' };
  }
  line.returns.push({ status: 'REQUESTED', quantity: requestedQty });
  return { ok: true };
}

test('A5: purchased qty 1, two concurrent returns → one succeeds', () => {
  const line = createLineStore(1);
  const a = tryCreateReturn(line, 1);
  const b = tryCreateReturn(line, 1);
  assert.equal(a.ok, true);
  assert.equal(b.ok, false);
  assert.equal(line.returns.length, 1);
});

test('A5: purchased qty 2, requests 1+1 → both succeed; third rejected', () => {
  const line = createLineStore(2);
  assert.equal(tryCreateReturn(line, 1).ok, true);
  assert.equal(tryCreateReturn(line, 1).ok, true);
  assert.equal(tryCreateReturn(line, 1).ok, false);
  assert.equal(line.returns.length, 2);
});

test('A5: cancelled line → ORDER_ITEM_CANCELLED', () => {
  const line = createLineStore(2);
  line.cancelledAt = new Date();
  const result = tryCreateReturn(line, 1);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ORDER_ITEM_CANCELLED');
  assert.equal(returnableQuantityForLine(line), 0);
});

test('A5: mixed cancelled / non-cancelled lines', () => {
  const cancelled = { quantity: 1, cancelledAt: new Date(), returns: [] };
  const active = createLineStore(1);
  assert.equal(tryCreateReturn(cancelled, 1).code, 'ORDER_ITEM_CANCELLED');
  assert.equal(tryCreateReturn(active, 1).ok, true);
});

test('A5: partial return leaves remaining units', () => {
  const line = createLineStore(5);
  assert.equal(tryCreateReturn(line, 2).ok, true);
  assert.equal(
    returnableQuantityForLine({
      quantity: line.quantity,
      returnRequests: line.returns,
    }),
    3
  );
  assert.equal(tryCreateReturn(line, 3).ok, true);
  assert.equal(tryCreateReturn(line, 1).ok, false);
});

test('A5: multiple return requests accumulate claims', () => {
  const line = createLineStore(4);
  tryCreateReturn(line, 1);
  tryCreateReturn(line, 1);
  tryCreateReturn(line, 1);
  assert.equal(tryCreateReturn(line, 2).ok, false);
  assert.equal(tryCreateReturn(line, 1).ok, true);
});
