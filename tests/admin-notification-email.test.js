import test from 'node:test';
import assert from 'node:assert/strict';
import { renderBrandedEmailTemplate } from '@babybarn/brand';
import {
  notifyEligibilityReview,
  notifyReturnRequest,
} from '../services/admin-notification.service.js';
import { normalizeNotificationPrefs } from '../lib/notification-prefs.js';

const brand = { name: 'Baby Barn', supportEmail: 'support@test.com' };

test('notifyReturnRequest does not throw for refurb returns', () => {
  assert.doesNotThrow(() =>
    notifyReturnRequest({
      publicId: 'ret_test_123',
      type: 'REFURBISHMENT',
      reason: 'Outgrown',
      order: { orderNumber: '1001', publicId: 'ord_1' },
      user: { email: 'customer@test.com' },
    })
  );
});

test('notifyEligibilityReview does not throw', () => {
  assert.doesNotThrow(() =>
    notifyEligibilityReview({
      publicId: 'ret_elig_123',
      type: 'REFURBISHMENT',
      order: { orderNumber: '1002' },
      user: { email: 'customer@test.com' },
    })
  );
});

test('notification prefs default to opted in for admin alerts', () => {
  const prefs = normalizeNotificationPrefs({});
  assert.equal(prefs.returnRequests, true);
  assert.equal(prefs.newOrders, true);
  assert.equal(prefs.lowStockAlerts, true);
});

test('admin return request email template renders', () => {
  const { subject, html } = renderBrandedEmailTemplate(
    'admin-return-request',
    {
      returnType: 'Refurb return',
      orderNumber: '#1001',
      customerEmail: 'customer@test.com',
      reason: 'Outgrown',
      actionUrl: 'http://localhost:3001/admin/inspection/ret_1',
    },
    brand
  );
  assert.match(subject, /New Refurb return request/);
  assert.match(html, /customer@test.com/);
});
