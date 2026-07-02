import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../utils/error-handler.js';
import {
  assertValidAdminNotificationModule,
} from '../services/admin-notification.service.js';
import { userCanSeeModule } from '../lib/admin-module-access.js';
import {
  resolveStandardReturnWindowStart,
  standardReturnWindowDaysLeft,
} from '../services/returns.service.js';

test('notification module validation rejects unknown modules', () => {
  assert.throws(
    () => assertValidAdminNotificationModule('not-a-real-module'),
    (error) => error instanceof AppError && error.statusCode === 500
  );
});

test('team users can open notifications page without assigned modules', () => {
  const user = { role: 'ADMIN_TEAM', adminModules: [] };
  assert.equal(userCanSeeModule(user, 'notifications'), true);
  assert.equal(userCanSeeModule(user, 'orders'), false);
});

test('standard return window starts from deliveredAt when available', () => {
  const deliveredAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const createdAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const start = resolveStandardReturnWindowStart({
    createdAt,
    deliveredAt,
    status: 'DELIVERED',
  });

  assert.equal(start?.toISOString(), deliveredAt.toISOString());
  assert.ok(standardReturnWindowDaysLeft({ createdAt, deliveredAt, status: 'DELIVERED' }) > 0);
});

test('standard return window stays closed before delivery', () => {
  const createdAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  assert.equal(
    resolveStandardReturnWindowStart({
      createdAt,
      deliveredAt: null,
      status: 'SHIPPED',
    }),
    null
  );
  assert.equal(
    standardReturnWindowDaysLeft({
      createdAt,
      deliveredAt: null,
      status: 'SHIPPED',
    }),
    0
  );
});
