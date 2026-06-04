import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config/env.js';

test('production config requires JWT_SECRET when NODE_ENV is production', () => {
  if (process.env.NODE_ENV === 'production') {
    assert.ok(process.env.JWT_SECRET, 'JWT_SECRET must be set in production');
  } else {
    assert.ok(config.jwt.secret);
  }
});

test('pending order TTL is a positive number', () => {
  assert.ok(config.pendingOrderTtlMinutes > 0);
});
