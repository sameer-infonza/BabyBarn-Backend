import test from 'node:test';
import assert from 'node:assert/strict';
import {
  claimedReturnQuantity,
  returnableQuantityForLine,
} from '../lib/return-quantity-policy.js';

test('rejected returns do not claim quantity', () => {
  const claimed = claimedReturnQuantity([
    { status: 'REJECTED', quantity: 1 },
    { status: 'REQUESTED', quantity: 1 },
  ]);
  assert.equal(claimed, 1);
});

test('partial returns leave remaining returnable units', () => {
  const remaining = returnableQuantityForLine({
    quantity: 3,
    returnRequests: [{ status: 'REQUESTED', quantity: 1 }],
  });
  assert.equal(remaining, 2);
});

test('partial standard return leaves remaining returnable units', () => {
  const remaining = returnableQuantityForLine({
    quantity: 6,
    returnRequests: [{ status: 'REQUESTED', type: 'STANDARD', quantity: 2 }],
  });
  assert.equal(remaining, 4);
});

test('mixed standard and refurb returns share the same quantity pool', () => {
  const remaining = returnableQuantityForLine({
    quantity: 6,
    returnRequests: [
      { status: 'APPROVED', type: 'STANDARD', quantity: 2 },
      { status: 'REQUESTED', type: 'REFURBISHMENT', quantity: 3 },
    ],
  });
  assert.equal(remaining, 1);
});

test('rejected standard return does not reduce returnable quantity', () => {
  const remaining = returnableQuantityForLine({
    quantity: 6,
    returnRequests: [
      { status: 'REJECTED', type: 'STANDARD', quantity: 2 },
      { status: 'REQUESTED', type: 'STANDARD', quantity: 2 },
    ],
  });
  assert.equal(remaining, 4);
});

test('fully claimed line has zero returnable units', () => {
  const remaining = returnableQuantityForLine({
    quantity: 2,
    returnRequests: [{ status: 'APPROVED', quantity: 2 }],
  });
  assert.equal(remaining, 0);
});
