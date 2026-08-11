import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertRefundWithinRemaining,
  derivePaymentStatusFromRefundTotals,
  resolveRemainingRefundableCents,
  usdToCents,
} from '../lib/order-refund-balance.js';
import {
  appendAppliedStripeRefundId,
  cancelCreditRestoreSourceKey,
  hasAppliedStripeRefundId,
} from '../lib/order-refund-side-effects.js';

/**
 * WS-A6 cancel refund gate — reuse WS1 helpers (no duplicated math).
 */
function planCancelRefund({ refundAmountUsd, stripeRemainingCents, localRemainingUsd }) {
  const remainingCents = resolveRemainingRefundableCents({
    stripeRemainingCents,
    localRemainingUsd,
  });
  let amountCents = usdToCents(refundAmountUsd);
  const within = assertRefundWithinRemaining(amountCents, remainingCents);
  if (!within.ok) {
    if (remainingCents <= 0) {
      return { ok: false, code: within.code, amountCents: 0 };
    }
    amountCents = Math.min(amountCents, remainingCents);
  } else {
    amountCents = Math.min(amountCents, remainingCents);
  }
  return { ok: amountCents > 0, amountCents, remainingCents };
}

test('A6: normal cancel refund within balance', () => {
  const plan = planCancelRefund({
    refundAmountUsd: 40,
    stripeRemainingCents: 5000,
    localRemainingUsd: 50,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.amountCents, 4000);
});

test('A6: partial previous refund then cancel uses remaining min(stripe, local)', () => {
  const plan = planCancelRefund({
    refundAmountUsd: 30,
    stripeRemainingCents: 2000,
    localRemainingUsd: 25,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.amountCents, 2000);
});

test('A6: cancel over remaining balance → rejected when remaining is 0', () => {
  const plan = planCancelRefund({
    refundAmountUsd: 10,
    stripeRemainingCents: 0,
    localRemainingUsd: 10,
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.code, 'REFUND_EXCEEDS_REMAINING');
});

test('A6: multiple cancel/refund ops leave PARTIALLY_REFUNDED until closed', () => {
  let paid = 10000;
  let refunded = 0;
  refunded += 3000;
  assert.equal(derivePaymentStatusFromRefundTotals(paid, refunded), 'PARTIALLY_REFUNDED');
  refunded += 7000;
  assert.equal(derivePaymentStatusFromRefundTotals(paid, refunded), 'REFUNDED');
});

test('A6: Stripe refund failure → no local financial side effects', () => {
  let applied = [];
  let restocked = false;
  let creditRestored = false;

  function afterStripe(ok, refundId) {
    if (!ok) return; // STRIPE_REFUND_FAILED — skip local tx
    if (hasAppliedStripeRefundId(applied, refundId)) return;
    restocked = true;
    creditRestored = true;
    applied = appendAppliedStripeRefundId(applied, refundId);
  }

  afterStripe(false, 're_fail');
  assert.equal(restocked, false);
  assert.equal(creditRestored, false);
  assert.deepEqual(applied, []);
});

test('A6: retry remains safe via appliedStripeRefundIds + cancel sourceKey', () => {
  let applied = [];
  let restockCount = 0;
  let creditCount = 0;
  const key = cancelCreditRestoreSourceKey('ord_1', 're_same');
  const creditKeys = new Set();

  function applyLocal(refundId) {
    if (hasAppliedStripeRefundId(applied, refundId)) return;
    restockCount += 1;
    if (!creditKeys.has(key)) {
      creditKeys.add(key);
      creditCount += 1;
    }
    applied = appendAppliedStripeRefundId(applied, refundId);
  }

  applyLocal('re_same');
  applyLocal('re_same');
  applyLocal('re_same');
  assert.equal(restockCount, 1);
  assert.equal(creditCount, 1);
});
