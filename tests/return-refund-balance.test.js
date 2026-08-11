import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertRefundWithinRemaining,
  derivePaymentStatusFromRefundTotals,
  extractStripeRefundBalance,
  isRefundablePaymentStatus,
  localRemainingRefundableUsd,
  moneyRound,
  resolveRemainingRefundableCents,
  sumRecordedReturnRefundsUsd,
  usdToCents,
  centsToUsd,
} from '../lib/order-refund-balance.js';
import {
  computeStandardReturnRefundAmount,
  computeReturnTaxShare,
  orderMerchandiseSubtotal,
} from '../services/return-refund.service.js';

test('isRefundablePaymentStatus allows PAID and PARTIALLY_REFUNDED only', () => {
  assert.equal(isRefundablePaymentStatus('PAID'), true);
  assert.equal(isRefundablePaymentStatus('PARTIALLY_REFUNDED'), true);
  assert.equal(isRefundablePaymentStatus('REFUNDED'), false);
  assert.equal(isRefundablePaymentStatus('UNPAID'), false);
  assert.equal(isRefundablePaymentStatus('FAILED'), false);
});

test('derivePaymentStatusFromRefundTotals maps paid/refunded cents', () => {
  assert.equal(derivePaymentStatusFromRefundTotals(9000, 0), 'PAID');
  assert.equal(derivePaymentStatusFromRefundTotals(9000, 4000), 'PARTIALLY_REFUNDED');
  assert.equal(derivePaymentStatusFromRefundTotals(9000, 9000), 'REFUNDED');
  assert.equal(derivePaymentStatusFromRefundTotals(9000, 9500), 'REFUNDED');
});

test('assertRefundWithinRemaining rejects over-refund and zero', () => {
  const over = assertRefundWithinRemaining(5000, 4000);
  assert.equal(over.ok, false);
  assert.equal(over.code, 'REFUND_EXCEEDS_REMAINING');

  const zero = assertRefundWithinRemaining(0, 4000);
  assert.equal(zero.ok, false);
  assert.equal(zero.code, 'REFUND_AMOUNT_INVALID');

  const ok = assertRefundWithinRemaining(4000, 4000);
  assert.equal(ok.ok, true);
});

test('resolveRemainingRefundableCents takes min of Stripe and local ledger', () => {
  assert.equal(
    resolveRemainingRefundableCents({ stripeRemainingCents: 5000, localRemainingUsd: 40 }),
    4000
  );
  assert.equal(
    resolveRemainingRefundableCents({ stripeRemainingCents: 3000, localRemainingUsd: 40 }),
    3000
  );
  assert.equal(
    resolveRemainingRefundableCents({ stripeRemainingCents: null, localRemainingUsd: 25.5 }),
    2550
  );
});

test('localRemainingRefundableUsd and return refund sum helpers', () => {
  assert.equal(localRemainingRefundableUsd({ totalAmount: 42.5 }), 42.5);
  assert.equal(localRemainingRefundableUsd({ totalAmount: -1 }), 0);
  assert.equal(
    sumRecordedReturnRefundsUsd([
      { stripeRefundId: 're_1', refundAmount: 10 },
      { refundedAt: new Date(), refundAmount: 5.25 },
      { refundAmount: 99 },
    ]),
    15.25
  );
});

test('extractStripeRefundBalance reads charge amounts', () => {
  const bal = extractStripeRefundBalance({
    amount_received: 9000,
    latest_charge: { amount: 9000, amount_refunded: 2500 },
  });
  assert.equal(bal.amountPaidCents, 9000);
  assert.equal(bal.amountRefundedCents, 2500);
  assert.equal(bal.remainingCents, 6500);
});

test('usd/cents conversion rounds consistently', () => {
  assert.equal(usdToCents(10.01), 1001);
  assert.equal(centsToUsd(1001), 10.01);
  assert.equal(moneyRound(10.019), 10.02);
});

test('scenario: fully paid order → full merchandise return refund amount', () => {
  const order = {
    taxAmount: 0,
    orderItems: [{ price: 40, quantity: 2, cancelledAt: null }],
  };
  const amount = computeStandardReturnRefundAmount({ price: 40 }, 2, order);
  assert.equal(amount, 80);
  const remaining = resolveRemainingRefundableCents({
    stripeRemainingCents: 9000, // $80 merch + $10 ship
    localRemainingUsd: 90,
  });
  assert.equal(assertRefundWithinRemaining(usdToCents(amount), remaining).ok, true);
  // After refund of $80, $10 shipping remains → PARTIALLY_REFUNDED
  assert.equal(derivePaymentStatusFromRefundTotals(9000, 8000), 'PARTIALLY_REFUNDED');
});

test('scenario: partially cancelled order → remaining return refund allowed', () => {
  // After cancel: totalAmount reduced to remaining card balance; payment PARTIALLY_REFUNDED
  const order = {
    paymentStatus: 'PARTIALLY_REFUNDED',
    totalAmount: 50, // $40 remaining merch + $10 ship
    taxAmount: 0,
    orderItems: [
      { price: 40, quantity: 1, cancelledAt: new Date() },
      { price: 40, quantity: 1, cancelledAt: null },
    ],
  };
  assert.equal(isRefundablePaymentStatus(order.paymentStatus), true);
  const amount = computeStandardReturnRefundAmount({ price: 40 }, 1, order);
  assert.equal(amount, 40);
  const remaining = resolveRemainingRefundableCents({
    stripeRemainingCents: 5000,
    localRemainingUsd: order.totalAmount,
  });
  assert.equal(assertRefundWithinRemaining(usdToCents(amount), remaining).ok, true);
  assert.equal(derivePaymentStatusFromRefundTotals(9000, 4000 + 4000), 'PARTIALLY_REFUNDED');
});

test('scenario: refund exceeding remaining is rejected', () => {
  const remaining = resolveRemainingRefundableCents({
    stripeRemainingCents: 1000,
    localRemainingUsd: 10,
  });
  const check = assertRefundWithinRemaining(2500, remaining);
  assert.equal(check.ok, false);
  assert.equal(check.code, 'REFUND_EXCEEDS_REMAINING');
});

test('scenario: multiple returns cannot exceed paid amount (capacity math)', () => {
  const paidCents = 9000;
  let refundedCents = 0;
  const returns = [3000, 3000, 4000]; // third would overshoot if not capped
  for (const [idx, req] of returns.entries()) {
    const remaining = paidCents - refundedCents;
    const check = assertRefundWithinRemaining(req, remaining);
    if (idx < 2) {
      assert.equal(check.ok, true);
      refundedCents += req;
    } else {
      assert.equal(check.ok, false);
    }
  }
  assert.equal(derivePaymentStatusFromRefundTotals(paidCents, refundedCents), 'PARTIALLY_REFUNDED');
});

test('scenario: after full payment refunded → REFUNDED', () => {
  assert.equal(derivePaymentStatusFromRefundTotals(5000, 5000), 'REFUNDED');
  assert.equal(isRefundablePaymentStatus('REFUNDED'), false);
});

test('tax share excludes cancelled lines after partial cancel', () => {
  const order = {
    taxAmount: 4, // remaining tax on active merch only
    orderItems: [
      { price: 40, quantity: 1, cancelledAt: new Date() },
      { price: 40, quantity: 1, cancelledAt: null },
    ],
  };
  assert.equal(orderMerchandiseSubtotal(order.orderItems, { excludeCancelled: true }), 40);
  assert.equal(computeReturnTaxShare(40, order), 4);
  assert.equal(computeStandardReturnRefundAmount({ price: 40 }, 1, order), 44);
});

test('concurrent over-refund capacity: two $40 requests against $50 remaining — only one fits', () => {
  const remaining = 5000;
  const first = assertRefundWithinRemaining(4000, remaining);
  assert.equal(first.ok, true);
  const afterFirst = remaining - 4000;
  const second = assertRefundWithinRemaining(4000, afterFirst);
  assert.equal(second.ok, false);
  assert.equal(second.code, 'REFUND_EXCEEDS_REMAINING');
});

test('admin full order refund defaults to remaining balance (not original total)', async () => {
  const { resolveAdminOrderRefundRequest, derivePaymentStatusFromRefundTotals } = await import(
    '../lib/order-refund-balance.js'
  );
  // Original $90 paid; $40 already cancelled → $50 remaining ledger/Stripe
  const req = resolveAdminOrderRefundRequest({ remainingCents: 5000, requestedAmountUsd: null });
  assert.equal(req.ok, true);
  assert.equal(req.refundAmountUsd, 50);
  assert.equal(req.isFullRemaining, true);
  assert.equal(derivePaymentStatusFromRefundTotals(9000, 4000 + 5000), 'REFUNDED');
});

test('admin order refund after return refund uses remaining only', async () => {
  const { resolveAdminOrderRefundRequest, assertRefundWithinRemaining, resolveRemainingRefundableCents } =
    await import('../lib/order-refund-balance.js');
  // Paid $90; return refunded $40 merch; $50 left (incl shipping)
  const remaining = resolveRemainingRefundableCents({
    stripeRemainingCents: 5000,
    localRemainingUsd: 50,
  });
  const admin = resolveAdminOrderRefundRequest({ remainingCents: remaining });
  assert.equal(admin.ok, true);
  assert.equal(admin.refundAmountUsd, 50);
  // Another $40 return after admin took remaining must fail
  assert.equal(assertRefundWithinRemaining(4000, 0).ok, false);
});

test('admin order refund rejects amount above remaining', async () => {
  const { resolveAdminOrderRefundRequest } = await import('../lib/order-refund-balance.js');
  const over = resolveAdminOrderRefundRequest({ remainingCents: 2500, requestedAmountUsd: 40 });
  assert.equal(over.ok, false);
  assert.equal(over.code, 'REFUND_EXCEEDS_REMAINING');
});

test('admin order refund rejects when no remaining balance', async () => {
  const { resolveAdminOrderRefundRequest, isRefundablePaymentStatus } = await import(
    '../lib/order-refund-balance.js'
  );
  const none = resolveAdminOrderRefundRequest({ remainingCents: 0 });
  assert.equal(none.ok, false);
  assert.equal(none.code, 'ORDER_ALREADY_REFUNDED');
  assert.equal(isRefundablePaymentStatus('REFUNDED'), false);
});

test('return then admin and admin then return share the same remaining capacity', async () => {
  const {
    resolveAdminOrderRefundRequest,
    assertRefundWithinRemaining,
    resolveRemainingRefundableCents,
    derivePaymentStatusFromRefundTotals,
  } = await import('../lib/order-refund-balance.js');

  let paid = 9000;
  let refunded = 0;

  // Path A: return $40 then admin remaining
  refunded += 4000;
  let remaining = resolveRemainingRefundableCents({
    stripeRemainingCents: paid - refunded,
    localRemainingUsd: (paid - refunded) / 100,
  });
  let admin = resolveAdminOrderRefundRequest({ remainingCents: remaining });
  assert.equal(admin.ok, true);
  assert.equal(admin.requestedCents, 5000);
  refunded += admin.requestedCents;
  assert.equal(derivePaymentStatusFromRefundTotals(paid, refunded), 'REFUNDED');
  assert.equal(assertRefundWithinRemaining(1, 0).ok, false);

  // Path B: admin $50 remaining first, then return cannot take more than leftover
  refunded = 0;
  remaining = resolveRemainingRefundableCents({
    stripeRemainingCents: 9000,
    localRemainingUsd: 90,
  });
  admin = resolveAdminOrderRefundRequest({ remainingCents: remaining, requestedAmountUsd: 50 });
  assert.equal(admin.ok, true);
  refunded += admin.requestedCents;
  remaining = paid - refunded;
  assert.equal(assertRefundWithinRemaining(4000, remaining).ok, true);
  assert.equal(assertRefundWithinRemaining(5000, remaining).ok, false);
});

test('classifyStripeRefundError maps amount_too_large', async () => {
  const { classifyStripeRefundError } = await import('../lib/order-refund-balance.js');
  const mapped = classifyStripeRefundError({ code: 'amount_too_large', message: 'too large' });
  assert.equal(mapped?.code, 'REFUND_EXCEEDS_REMAINING');
  assert.equal(classifyStripeRefundError({ code: 'card_declined' }), null);
});
