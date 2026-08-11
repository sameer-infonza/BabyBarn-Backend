import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canCustomerCancelOrder,
  customerCancelUnavailableReason,
} from '../lib/customer-order-cancellation.js';

const recent = () => new Date(Date.now() - 5 * 60 * 1000);

test('blocks unpaid pending order — cancel window starts only after payment auto-accept', () => {
  assert.equal(
    canCustomerCancelOrder({
      status: 'PENDING',
      paymentStatus: 'UNPAID',
      fulfillmentStatus: null,
      createdAt: recent(),
    }),
    false
  );
});

test('allows paid processing order in NEW_ORDER fulfillment within window', () => {
  assert.equal(
    canCustomerCancelOrder({
      status: 'PROCESSING',
      paymentStatus: 'PAID',
      fulfillmentStatus: 'NEW_ORDER',
      createdAt: recent(),
    }),
    true
  );
});

test('allows paid ACCEPTED order within cancel window (auto-accept is not packing)', () => {
  const acceptedAt = recent();
  assert.equal(
    canCustomerCancelOrder({
      status: 'PROCESSING',
      paymentStatus: 'PAID',
      fulfillmentStatus: 'ACCEPTED',
      fulfillmentAcceptedAt: acceptedAt,
      createdAt: acceptedAt,
    }),
    true
  );
});

test('blocks after warehouse packing starts (PICKUP_READY+)', () => {
  const acceptedAt = recent();
  assert.equal(
    canCustomerCancelOrder({
      status: 'PROCESSING',
      paymentStatus: 'PAID',
      fulfillmentStatus: 'PICKUP_READY',
      fulfillmentAcceptedAt: acceptedAt,
      createdAt: acceptedAt,
    }),
    false
  );
  assert.match(
    customerCancelUnavailableReason({
      status: 'PROCESSING',
      paymentStatus: 'PAID',
      fulfillmentStatus: 'PICKUP_READY',
      fulfillmentAcceptedAt: acceptedAt,
      createdAt: acceptedAt,
    }),
    /Warehouse processing/i
  );
});

test('blocks delivered and terminal orders', () => {
  assert.equal(
    canCustomerCancelOrder({ status: 'DELIVERED', fulfillmentStatus: 'DELIVERED', deliveredAt: new Date() }),
    false
  );
  assert.equal(canCustomerCancelOrder({ status: 'CANCELLED' }), false);
  assert.equal(canCustomerCancelOrder({ status: 'SHIPPED', fulfillmentStatus: 'SHIPPED' }), false);
});

test('blocks legacy pending review', () => {
  assert.equal(
    canCustomerCancelOrder({
      status: 'PENDING',
      paymentStatus: 'UNPAID',
      cancellationReviewStatus: 'PENDING',
      createdAt: recent(),
    }),
    false
  );
});

test('allows partial cancel when some lines remain active', () => {
  assert.equal(
    canCustomerCancelOrder({
      status: 'PROCESSING',
      paymentStatus: 'PARTIALLY_REFUNDED',
      fulfillmentStatus: 'NEW_ORDER',
      createdAt: recent(),
      orderItems: [
        { publicId: 'a', cancelledAt: new Date() },
        { publicId: 'b', cancelledAt: null },
      ],
    }),
    true
  );
});

test('blocks when every line is already cancelled', () => {
  assert.equal(
    canCustomerCancelOrder({
      status: 'PROCESSING',
      paymentStatus: 'PARTIALLY_REFUNDED',
      fulfillmentStatus: 'NEW_ORDER',
      createdAt: recent(),
      orderItems: [
        { publicId: 'a', cancelledAt: new Date() },
        { publicId: 'b', cancelledAt: new Date() },
      ],
    }),
    false
  );
});

test('blocks when 60-minute window has ended', () => {
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
  assert.equal(
    canCustomerCancelOrder({
      status: 'PROCESSING',
      paymentStatus: 'PAID',
      fulfillmentStatus: 'ACCEPTED',
      fulfillmentAcceptedAt: old,
      createdAt: old,
    }),
    false
  );
  assert.match(
    customerCancelUnavailableReason({
      status: 'PROCESSING',
      paymentStatus: 'PAID',
      fulfillmentStatus: 'ACCEPTED',
      fulfillmentAcceptedAt: old,
      createdAt: old,
    }),
    /60-minute/i
  );
});
