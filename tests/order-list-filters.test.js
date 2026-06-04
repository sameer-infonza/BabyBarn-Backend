import test from 'node:test';
import assert from 'node:assert/strict';
import { OrderService } from '../services/order.service.js';

const orderService = new OrderService();

test('buildUserOrderListWhere delivered uses enum status not string contains', () => {
  const where = orderService.buildUserOrderListWhere(1, { tab: 'delivered', periodMonths: '12' });
  const and = where.AND;
  const deliveredClause = and.find(
    (c) => c.OR && c.OR.some((o) => o.status === 'DELIVERED' || o.fulfillmentStatus === 'DELIVERED')
  );
  assert.ok(deliveredClause, 'expected delivered OR clause');
  assert.ok(deliveredClause.OR.some((o) => o.status === 'DELIVERED'));
  assert.ok(
    !deliveredClause.OR.some((o) => typeof o.status === 'object' && o.status?.contains),
    'must not use string contains on enum status'
  );
});

test('buildUserOrderListWhere active excludes terminal statuses', () => {
  const where = orderService.buildUserOrderListWhere(1, { tab: 'active' });
  const activeClause = where.AND.find((c) => c.status?.notIn);
  assert.ok(activeClause);
  assert.deepEqual(activeClause.status.notIn, ['DELIVERED', 'CANCELLED', 'REFUNDED', 'RETURNED']);
});
