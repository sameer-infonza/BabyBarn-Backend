import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canCustomerCancelOrder,
  customerCancelUnavailableReason,
} from '../lib/customer-order-cancellation.js';

test('allows unpaid pending order before warehouse acceptance', () => {
  assert.equal(
    canCustomerCancelOrder({
      status: 'PENDING',
      paymentStatus: 'UNPAID',
      fulfillmentStatus: null,
    }),
    true
  );
});

test('allows paid processing order in NEW_ORDER fulfillment', () => {
  assert.equal(
    canCustomerCancelOrder({
      status: 'PROCESSING',
      paymentStatus: 'PAID',
      fulfillmentStatus: 'NEW_ORDER',
    }),
    true
  );
});

test('blocks after warehouse acceptance', () => {
  assert.equal(
    canCustomerCancelOrder({
      status: 'PROCESSING',
      paymentStatus: 'PAID',
      fulfillmentStatus: 'ACCEPTED',
    }),
    false
  );
  assert.match(customerCancelUnavailableReason({
    status: 'PROCESSING',
    paymentStatus: 'PAID',
    fulfillmentStatus: 'ACCEPTED',
  }), /Warehouse processing/i);
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
      orderItems: [
        { publicId: 'a', cancelledAt: new Date() },
        { publicId: 'b', cancelledAt: new Date() },
      ],
    }),
    false
  );
});
