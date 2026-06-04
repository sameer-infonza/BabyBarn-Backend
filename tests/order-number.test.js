import test from 'node:test';
import assert from 'node:assert/strict';
import { formatOrderNumber, placeholderOrderNumber } from '../utils/order-number.js';

test('formatOrderNumber pads internal id', () => {
  assert.equal(formatOrderNumber(42), 'BB-000042');
});

test('placeholderOrderNumber is unique', () => {
  const a = placeholderOrderNumber();
  const b = placeholderOrderNumber();
  assert.notEqual(a, b);
  assert.match(a, /^PENDING-/);
});
