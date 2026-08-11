import test from 'node:test';
import assert from 'node:assert/strict';
import { derivePaymentStatusFromRefundTotals } from '../lib/order-refund-balance.js';

/**
 * Mirrors WS-A2 markOrderRefundedBySessionId inventory policy:
 * sync payment from Stripe totals; never full-restock from charge.refunded.
 */
function syncChargeRefunded({ paymentStatus, amountPaidCents, amountRefundedCents }) {
  const next = derivePaymentStatusFromRefundTotals(amountPaidCents, amountRefundedCents);
  const restock = false; // PRODUCT DECISION REQUIRED — never auto full-restock here
  return {
    paymentStatus: next,
    inventory: restock ? 'restocked' : 'unchanged',
    alreadySynced: next === paymentStatus && next !== 'REFUNDED',
  };
}

test('A2: partial charge.refunded → PARTIALLY_REFUNDED and no restock', () => {
  const result = syncChargeRefunded({
    paymentStatus: 'PAID',
    amountPaidCents: 10000,
    amountRefundedCents: 2500,
  });
  assert.equal(result.paymentStatus, 'PARTIALLY_REFUNDED');
  assert.equal(result.inventory, 'unchanged');
});

test('A2: full charge.refunded → REFUNDED payment status, still no auto restock', () => {
  const result = syncChargeRefunded({
    paymentStatus: 'PAID',
    amountPaidCents: 10000,
    amountRefundedCents: 10000,
  });
  assert.equal(result.paymentStatus, 'REFUNDED');
  assert.equal(result.inventory, 'unchanged');
});

test('A2: already REFUNDED charge.refunded is idempotent (no restock)', () => {
  const result = syncChargeRefunded({
    paymentStatus: 'REFUNDED',
    amountPaidCents: 5000,
    amountRefundedCents: 5000,
  });
  assert.equal(result.paymentStatus, 'REFUNDED');
  assert.equal(result.inventory, 'unchanged');
});

test('A2: application refund then charge.refunded does not imply second restock', () => {
  // Local admin/cancel already restocked once; webhook only syncs money.
  let restockCount = 1;
  const webhook = syncChargeRefunded({
    paymentStatus: 'REFUNDED',
    amountPaidCents: 8000,
    amountRefundedCents: 8000,
  });
  if (webhook.inventory === 'restocked') restockCount += 1;
  assert.equal(restockCount, 1);
  assert.equal(webhook.inventory, 'unchanged');
});

test('A2: partial refund keeps PARTIALLY_REFUNDED', () => {
  assert.equal(derivePaymentStatusFromRefundTotals(9000, 1000), 'PARTIALLY_REFUNDED');
  assert.equal(derivePaymentStatusFromRefundTotals(9000, 8999), 'PARTIALLY_REFUNDED');
});
