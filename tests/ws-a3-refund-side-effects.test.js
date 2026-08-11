import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendAppliedStripeRefundId,
  cancelCreditRestoreSourceKey,
  hasAppliedStripeRefundId,
  parseAppliedStripeRefundIds,
  adminRefundSideEffectKey,
} from '../lib/order-refund-side-effects.js';
import { resolveAdminOrderRefundRequest } from '../lib/order-refund-balance.js';

test('A3: appliedStripeRefundIds parse/append/has', () => {
  assert.deepEqual(parseAppliedStripeRefundIds(null), []);
  assert.deepEqual(parseAppliedStripeRefundIds(['re_1']), ['re_1']);
  assert.equal(hasAppliedStripeRefundId(['re_1'], 're_1'), true);
  assert.equal(hasAppliedStripeRefundId(['re_1'], 're_2'), false);
  assert.deepEqual(appendAppliedStripeRefundId(['re_1'], 're_2'), ['re_1', 're_2']);
  assert.deepEqual(appendAppliedStripeRefundId(['re_1'], 're_1'), ['re_1']);
});

test('A3: same Stripe refund ID twice → side effects applied once', () => {
  let restockCount = 0;
  let creditRestoreCount = 0;
  let applied = [];

  function applyRefundSideEffects(stripeRefundId, { isFullRemaining, creditShare }) {
    if (hasAppliedStripeRefundId(applied, stripeRefundId)) {
      return { skipped: true, restockCount, creditRestoreCount };
    }
    if (isFullRemaining) restockCount += 1;
    if (creditShare > 0) creditRestoreCount += 1;
    applied = appendAppliedStripeRefundId(applied, stripeRefundId);
    return { skipped: false, restockCount, creditRestoreCount };
  }

  const first = applyRefundSideEffects('re_abc', { isFullRemaining: true, creditShare: 5 });
  const second = applyRefundSideEffects('re_abc', { isFullRemaining: true, creditShare: 5 });
  assert.equal(first.skipped, false);
  assert.equal(second.skipped, true);
  assert.equal(restockCount, 1);
  assert.equal(creditRestoreCount, 1);
});

test('A3: admin full remaining → restock allowed; partial → no merchandise restock', () => {
  const full = resolveAdminOrderRefundRequest({ remainingCents: 5000, requestedAmountUsd: null });
  assert.equal(full.ok, true);
  assert.equal(full.isFullRemaining, true);

  const partial = resolveAdminOrderRefundRequest({ remainingCents: 5000, requestedAmountUsd: 10 });
  assert.equal(partial.ok, true);
  assert.equal(partial.isFullRemaining, false);

  // Interim policy gate (matches refundOrder)
  const shouldRestock = (req) => Boolean(req.isFullRemaining);
  assert.equal(shouldRestock(full), true);
  assert.equal(shouldRestock(partial), false);
});

test('A3: cancel credit restore sourceKey is deterministic and cancel-scoped', () => {
  const a = cancelCreditRestoreSourceKey('ord_1', 're_9');
  const b = cancelCreditRestoreSourceKey('ord_1', 're_9');
  const c = cancelCreditRestoreSourceKey('ord_1', 're_8');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^restore:cancel:/);
  assert.notEqual(a, adminRefundSideEffectKey('ord_1', 're_9'));
});

test('A3: cancel credit restoration retry with same sourceKey credits once', () => {
  const ledger = new Map();
  let balance = 0;

  function restoreOnce(amount, sourceKey) {
    if (ledger.has(sourceKey)) return { created: false };
    ledger.set(sourceKey, amount);
    balance += amount;
    return { created: true };
  }

  const key = cancelCreditRestoreSourceKey('ord_x', 're_y');
  assert.equal(restoreOnce(12, key).created, true);
  assert.equal(restoreOnce(12, key).created, false);
  assert.equal(restoreOnce(12, key).created, false);
  assert.equal(balance, 12);
  assert.equal(ledger.size, 1);
});

test('A3: payment status after full vs partial remaining refund', () => {
  const full = resolveAdminOrderRefundRequest({ remainingCents: 4000, requestedAmountUsd: null });
  assert.equal(full.isFullRemaining, true);
  const partial = resolveAdminOrderRefundRequest({ remainingCents: 4000, requestedAmountUsd: 15 });
  assert.equal(partial.isFullRemaining, false);
  assert.equal(partial.refundAmountUsd, 15);
});
