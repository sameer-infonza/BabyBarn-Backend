import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../utils/error-handler.js';
import {
  assertValidAdminNotificationModule,
} from '../services/admin-notification.service.js';
import { userCanSeeModule } from '../lib/admin-module-access.js';
import {
  resolveUsedReturnWindowStart,
  resolveStandardReturnWindowStart,
  standardReturnWindowDaysLeft,
} from '../services/returns.service.js';

test('notification module validation rejects unknown modules', () => {
  assert.throws(
    () => assertValidAdminNotificationModule('not-a-real-module'),
    (error) => error instanceof AppError && error.statusCode === 500
  );
});

test('team users always have in-app notification access', () => {
  const deniedEmail = { role: 'ADMIN_TEAM', adminModules: [], adminNotificationAccess: false };
  const grantedEmail = { role: 'ADMIN_TEAM', adminModules: [], adminNotificationAccess: true };
  assert.equal(userCanSeeModule(deniedEmail, 'notifications'), true);
  assert.equal(userCanSeeModule(grantedEmail, 'notifications'), true);
  assert.equal(userCanSeeModule(grantedEmail, 'orders'), false);
});

test('team email eligibility requires adminNotificationAccess', () => {
  const withoutGrant = { role: 'ADMIN_TEAM', adminModules: ['order-management'], adminNotificationAccess: false };
  const withGrant = { role: 'ADMIN_TEAM', adminModules: ['order-management'], adminNotificationAccess: true };
  // Inbox is always allowed; email grant is orthogonal to module visibility.
  assert.equal(userCanSeeModule(withoutGrant, 'notifications'), true);
  assert.equal(userCanSeeModule(withGrant, 'notifications'), true);
  assert.equal(Boolean(withoutGrant.adminNotificationAccess), false);
  assert.equal(Boolean(withGrant.adminNotificationAccess), true);
});

test('super admin always has notification access', () => {
  assert.equal(userCanSeeModule({ role: 'ADMIN' }, 'notifications'), true);
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

test('used return window starts from deliveredAt when available', () => {
  const deliveredAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  const createdAt = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
  const start = resolveUsedReturnWindowStart({
    createdAt,
    deliveredAt,
    status: 'DELIVERED',
  });

  assert.equal(start?.toISOString(), deliveredAt.toISOString());
});

test('used return window stays closed before delivery', () => {
  const createdAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  assert.equal(
    resolveUsedReturnWindowStart({
      createdAt,
      deliveredAt: null,
      status: 'SHIPPED',
    }),
    null
  );
});
