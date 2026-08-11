import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildCustomerActiveWhere,
  buildCustomerDeliveredWhere,
  buildCustomerHasAnyReturnWhere,
  buildCustomerInTransitWhere,
  matchCustomerActive,
  matchCustomerDelivered,
  matchCustomerInTransit,
} from '../lib/order-query-filters.js';
import { OrderService } from '../services/order.service.js';

const orderService = new OrderService();

describe('ORD-001 P6d — customer Delivered triad', () => {
  it('status / fulfillment / deliveredAt all match', () => {
    assert.equal(matchCustomerDelivered({ status: 'DELIVERED' }), true);
    assert.equal(
      matchCustomerDelivered({ status: 'PROCESSING', fulfillmentStatus: 'DELIVERED' }),
      true
    );
    assert.equal(
      matchCustomerDelivered({
        status: 'PROCESSING',
        fulfillmentStatus: 'SHIPPED',
        deliveredAt: '2026-08-01',
      }),
      true
    );
    assert.equal(
      matchCustomerDelivered({ status: 'PROCESSING', fulfillmentStatus: 'ACCEPTED' }),
      false
    );
  });

  it('list builder is the canonical triad', () => {
    assert.deepEqual(buildCustomerDeliveredWhere(), {
      OR: [
        { status: 'DELIVERED' },
        { fulfillmentStatus: 'DELIVERED' },
        { deliveredAt: { not: null } },
      ],
    });
  });
});

describe('ORD-001 P6d — customer Active', () => {
  for (const fs of ['ACCEPTED', 'PICKUP_READY', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY']) {
    it(`${fs} → Active`, () => {
      assert.equal(
        matchCustomerActive({ status: 'PROCESSING', fulfillmentStatus: fs }),
        true
      );
    });
  }

  it('DELIVERED / CANCELLED / REFUNDED / RETURNED → not Active', () => {
    assert.equal(matchCustomerActive({ status: 'DELIVERED' }), false);
    assert.equal(
      matchCustomerActive({ status: 'PROCESSING', fulfillmentStatus: 'DELIVERED' }),
      false
    );
    assert.equal(matchCustomerActive({ status: 'CANCELLED' }), false);
    assert.equal(matchCustomerActive({ status: 'REFUNDED' }), false);
    assert.equal(matchCustomerActive({ status: 'RETURNED' }), false);
  });

  it('UNPAID / PARTIALLY_REFUNDED warehouse stay Active', () => {
    assert.equal(
      matchCustomerActive({ status: 'PENDING', fulfillmentStatus: null, paymentStatus: 'UNPAID' }),
      true
    );
    assert.equal(
      matchCustomerActive({
        status: 'PROCESSING',
        fulfillmentStatus: 'ACCEPTED',
        paymentStatus: 'PARTIALLY_REFUNDED',
      }),
      true
    );
  });

  it('Active list where uses NOT delivered triad + excluded statuses', () => {
    const w = buildCustomerActiveWhere();
    assert.deepEqual(w.AND[0], { NOT: buildCustomerDeliveredWhere() });
    assert.deepEqual(w.AND[1].status.notIn, ['CANCELLED', 'REFUNDED', 'RETURNED']);
  });
});

describe('ORD-001 P6d — customer inTransit (no tracking)', () => {
  for (const fs of ['SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY']) {
    it(`${fs} → inTransit`, () => {
      assert.equal(
        matchCustomerInTransit({ status: 'PROCESSING', fulfillmentStatus: fs }),
        true
      );
    });
  }

  it('PICKUP_READY / ACCEPTED ± tracking → not inTransit', () => {
    assert.equal(
      matchCustomerInTransit({
        status: 'PROCESSING',
        fulfillmentStatus: 'PICKUP_READY',
        trackingNumber: '1Z999',
      }),
      false
    );
    assert.equal(
      matchCustomerInTransit({
        status: 'PROCESSING',
        fulfillmentStatus: 'ACCEPTED',
        trackingNumber: '1Z999',
      }),
      false
    );
  });

  it('historical status=SHIPPED + null fulfillment → inTransit', () => {
    assert.equal(
      matchCustomerInTransit({ status: 'SHIPPED', fulfillmentStatus: null }),
      true
    );
  });

  it('inTransit builder never keys on trackingNumber', () => {
    assert.ok(!JSON.stringify(buildCustomerInTransitWhere()).includes('trackingNumber'));
  });
});

describe('ORD-001 P6d — partial refund matrix', () => {
  it('PARTIALLY_REFUNDED + ACCEPTED → Active, not Delivered, not inTransit', () => {
    const o = {
      status: 'PROCESSING',
      paymentStatus: 'PARTIALLY_REFUNDED',
      fulfillmentStatus: 'ACCEPTED',
    };
    assert.equal(matchCustomerActive(o), true);
    assert.equal(matchCustomerDelivered(o), false);
    assert.equal(matchCustomerInTransit(o), false);
  });

  it('PARTIALLY_REFUNDED + PICKUP_READY → Active, not inTransit', () => {
    const o = {
      status: 'PROCESSING',
      paymentStatus: 'PARTIALLY_REFUNDED',
      fulfillmentStatus: 'PICKUP_READY',
      trackingNumber: '1Z',
    };
    assert.equal(matchCustomerActive(o), true);
    assert.equal(matchCustomerInTransit(o), false);
  });

  it('PARTIALLY_REFUNDED + IN_TRANSIT → Active + inTransit', () => {
    const o = {
      status: 'PROCESSING',
      paymentStatus: 'PARTIALLY_REFUNDED',
      fulfillmentStatus: 'IN_TRANSIT',
    };
    assert.equal(matchCustomerActive(o), true);
    assert.equal(matchCustomerInTransit(o), true);
  });

  it('PARTIALLY_REFUNDED + DELIVERED → Delivered, not Active', () => {
    const o = {
      status: 'PROCESSING',
      paymentStatus: 'PARTIALLY_REFUNDED',
      fulfillmentStatus: 'DELIVERED',
    };
    assert.equal(matchCustomerDelivered(o), true);
    assert.equal(matchCustomerActive(o), false);
  });
});

describe('ORD-001 P6d — Returns = any ReturnRequest', () => {
  it('builder stays some:{}', () => {
    assert.deepEqual(buildCustomerHasAnyReturnWhere(), { returnRequests: { some: {} } });
  });
});

describe('ORD-001 P6d — list/count predicate identity', () => {
  it('Active / Delivered / Returns list wheres match builders', () => {
    const active = orderService.buildUserOrderListWhere(1, { tab: 'active' });
    assert.deepEqual(
      active.AND.find((c) => c.AND),
      buildCustomerActiveWhere()
    );

    const delivered = orderService.buildUserOrderListWhere(1, { tab: 'delivered' });
    assert.deepEqual(
      delivered.AND.find((c) => c.OR),
      buildCustomerDeliveredWhere()
    );

    const returns = orderService.buildUserOrderListWhere(1, { tab: 'returns' });
    assert.ok(returns.AND.some((c) => c.returnRequests?.some));
    assert.deepEqual(
      returns.AND.find((c) => c.returnRequests),
      buildCustomerHasAnyReturnWhere()
    );
  });
});
