import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildLegacyAdminStatusGroupWhere,
  buildReturnedWhere,
} from '../lib/order-query-filters.js';

/**
 * In-memory mirror of buildReturnedWhere for inclusion matrix tests.
 * Must stay in lockstep with backend/lib/order-query-filters.js buildReturnedWhere.
 */
function orderMatchesReturnedWhere(order) {
  if (String(order.status || '').toUpperCase() === 'RETURNED') return true;
  const rows = order.returnRequests || [];
  return rows.some((rr) => {
    const type = String(rr.type || '').toUpperCase();
    const status = String(rr.status || '').toUpperCase();
    if (type === 'STANDARD' && status === 'APPROVED') return true;
    if (type === 'REFURBISHMENT' && status === 'INSPECTION_APPROVED') return true;
    return false;
  });
}

describe('ORD-001 P6b — Admin Returned tab predicate', () => {
  it('statusGroup=returned uses buildReturnedWhere (list/count same builder)', () => {
    const fromGroup = buildLegacyAdminStatusGroupWhere('returned');
    assert.deepEqual(fromGroup, buildReturnedWhere());
    // Granular Order.status is ignored on queue tabs (P6c); predicate stays Returned.
    assert.deepEqual(buildLegacyAdminStatusGroupWhere('returned', 'RETURNED'), buildReturnedWhere());
    assert.deepEqual(buildLegacyAdminStatusGroupWhere('returned', 'SHIPPED'), buildReturnedWhere());
  });

  it('predicate shape: type-scoped completion + historical RETURNED', () => {
    const w = buildReturnedWhere();
    assert.ok(w.OR.some((c) => c.status === 'RETURNED'));
    const some = w.OR.find((c) => c.returnRequests?.some)?.returnRequests.some.OR;
    assert.ok(some.some((c) => c.type === 'STANDARD' && c.status === 'APPROVED'));
    assert.ok(some.some((c) => c.type === 'REFURBISHMENT' && c.status === 'INSPECTION_APPROVED'));
    assert.ok(!some.some((c) => c.type === 'REFURBISHMENT' && c.status === 'APPROVED'));
    assert.ok(!JSON.stringify(w).includes('refundedAt'));
    assert.ok(!JSON.stringify(w).includes('restockedAt'));
  });

  describe('STANDARD matrix', () => {
    for (const status of ['REQUESTED', 'RECEIVED', 'UNDER_INSPECTION', 'REJECTED']) {
      it(`STANDARD ${status} → excluded`, () => {
        assert.equal(
          orderMatchesReturnedWhere({
            status: 'DELIVERED',
            returnRequests: [{ type: 'STANDARD', status }],
          }),
          false
        );
      });
    }
    it('STANDARD APPROVED → included', () => {
      assert.equal(
        orderMatchesReturnedWhere({
          status: 'DELIVERED',
          returnRequests: [{ type: 'STANDARD', status: 'APPROVED' }],
        }),
        true
      );
    });
  });

  describe('REFURBISHMENT matrix', () => {
    for (const status of [
      'REQUESTED',
      'ELIGIBILITY_REVIEW',
      'APPROVED',
      'LABEL_GENERATED',
      'IN_TRANSIT',
      'RECEIVED',
      'UNDER_INSPECTION',
      'INSPECTION_REJECTED',
    ]) {
      it(`REFURB ${status} → excluded`, () => {
        assert.equal(
          orderMatchesReturnedWhere({
            status: 'DELIVERED',
            returnRequests: [{ type: 'REFURBISHMENT', status }],
          }),
          false
        );
      });
    }
    it('REFURB INSPECTION_APPROVED → included', () => {
      assert.equal(
        orderMatchesReturnedWhere({
          status: 'DELIVERED',
          returnRequests: [{ type: 'REFURBISHMENT', status: 'INSPECTION_APPROVED' }],
        }),
        true
      );
    });
  });

  describe('mixed / partial / historical', () => {
    it('completed + active → included', () => {
      assert.equal(
        orderMatchesReturnedWhere({
          status: 'DELIVERED',
          returnRequests: [
            { type: 'STANDARD', status: 'APPROVED' },
            { type: 'STANDARD', status: 'REQUESTED' },
          ],
        }),
        true
      );
    });

    it('completed + rejected → included', () => {
      assert.equal(
        orderMatchesReturnedWhere({
          status: 'DELIVERED',
          returnRequests: [
            { type: 'STANDARD', status: 'APPROVED' },
            { type: 'STANDARD', status: 'REJECTED' },
          ],
        }),
        true
      );
    });

    it('active only → excluded', () => {
      assert.equal(
        orderMatchesReturnedWhere({
          status: 'DELIVERED',
          returnRequests: [{ type: 'STANDARD', status: 'UNDER_INSPECTION' }],
        }),
        false
      );
    });

    it('rejected only → excluded', () => {
      assert.equal(
        orderMatchesReturnedWhere({
          status: 'DELIVERED',
          returnRequests: [{ type: 'STANDARD', status: 'REJECTED' }],
        }),
        false
      );
    });

    it('partial: one APPROVED line + remaining active → included', () => {
      assert.equal(
        orderMatchesReturnedWhere({
          status: 'DELIVERED',
          returnRequests: [
            { type: 'STANDARD', status: 'APPROVED' },
            { type: 'REFURBISHMENT', status: 'APPROVED' },
            { type: 'STANDARD', status: 'RECEIVED' },
          ],
        }),
        true
      );
    });

    it('historical Order.status RETURNED + no ReturnRequest → included', () => {
      assert.equal(orderMatchesReturnedWhere({ status: 'RETURNED', returnRequests: [] }), true);
    });

    it('historical non-RETURNED + no completed return → excluded', () => {
      assert.equal(
        orderMatchesReturnedWhere({
          status: 'DELIVERED',
          returnRequests: [],
        }),
        false
      );
    });

    it('REFURB eligibility APPROVED alone is not returned', () => {
      assert.equal(
        orderMatchesReturnedWhere({
          status: 'DELIVERED',
          returnRequests: [{ type: 'REFURBISHMENT', status: 'APPROVED' }],
        }),
        false
      );
    });
  });

  it('list and count share identical predicate via statusGroup returned', () => {
    const listWhere = buildLegacyAdminStatusGroupWhere('returned');
    const countWhere = buildReturnedWhere();
    assert.deepEqual(listWhere, countWhere);
  });
});
