import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AppError } from '../utils/error-handler.js';
import {
  assertOrderLineEligibleForReturnType,
  assertSelectedOrderLinesEligibleForReturnType,
  isOrderLineEligibleForReturnType,
} from '../lib/return-product-eligibility.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('BR-001: NEW → STANDARD allowed', () => {
  assert.doesNotThrow(() =>
    assertOrderLineEligibleForReturnType({ returnType: 'STANDARD', productType: 'NEW' })
  );
  assert.equal(isOrderLineEligibleForReturnType({ returnType: 'STANDARD', productType: 'NEW' }), true);
});

test('BR-001: REFURBISHED → STANDARD rejected with STANDARD_RETURN_REFURBISHED_NOT_ALLOWED', () => {
  assert.throws(
    () => assertOrderLineEligibleForReturnType({ returnType: 'STANDARD', productType: 'REFURBISHED' }),
    (err) =>
      err instanceof AppError &&
      err.statusCode === 400 &&
      err.code === 'STANDARD_RETURN_REFURBISHED_NOT_ALLOWED'
  );
  assert.equal(
    isOrderLineEligibleForReturnType({ returnType: 'STANDARD', productType: 'REFURBISHED' }),
    false
  );
});

test('BR-001: NEW → REFURBISHMENT allowed at product-condition layer', () => {
  // ACCESS / window / feature flags remain separate create-time checks.
  assert.doesNotThrow(() =>
    assertOrderLineEligibleForReturnType({ returnType: 'REFURBISHMENT', productType: 'NEW' })
  );
});

test('BR-001: REFURBISHED → REFURBISHMENT rejected (existing message preserved)', () => {
  assert.throws(
    () => assertOrderLineEligibleForReturnType({ returnType: 'REFURBISHMENT', productType: 'REFURBISHED' }),
    (err) =>
      err instanceof AppError &&
      err.statusCode === 400 &&
      String(err.message).includes('only available for eligible new items')
  );
});

test('BR-001: mixed order with only NEW IDs → STANDARD allowed', () => {
  assert.doesNotThrow(() =>
    assertSelectedOrderLinesEligibleForReturnType('STANDARD', [
      { product: { productType: 'NEW' } },
      { product: { productType: 'NEW' } },
    ])
  );
});

test('BR-001: mixed order containing REFURBISHED ID → STANDARD request rejected', () => {
  assert.throws(
    () =>
      assertSelectedOrderLinesEligibleForReturnType('STANDARD', [
        { product: { productType: 'NEW' } },
        { product: { productType: 'REFURBISHED' } },
      ]),
    (err) => err instanceof AppError && err.code === 'STANDARD_RETURN_REFURBISHED_NOT_ALLOWED'
  );
});

test('BR-001: missing productType treated as NEW (historical / incomplete classification)', () => {
  assert.doesNotThrow(() =>
    assertOrderLineEligibleForReturnType({ returnType: 'STANDARD', productType: null })
  );
  assert.doesNotThrow(() =>
    assertOrderLineEligibleForReturnType({ returnType: 'STANDARD', productType: undefined })
  );
});

test('BR-001: customer and guest create share createForUser validation', () => {
  const source = readFileSync(join(__dirname, '../services/returns.service.js'), 'utf8');
  assert.match(source, /assertOrderLineEligibleForReturnType/);
  assert.match(source, /async createForGuest\(/);
  assert.match(source, /return this\.createForUser\(/);
  // Guest forces STANDARD then delegates — same BR-001 loop as authenticated create.
  const guestFn = source.slice(source.indexOf('async createForGuest('), source.indexOf('async reviewEligibility('));
  assert.match(guestFn, /type:\s*'STANDARD'/);
  assert.match(guestFn, /this\.createForUser/);
});

test('BR-001: existing open returns are not invalidated by product eligibility helper', () => {
  // Create-time helper only; status / refund / inspection paths must not call it.
  const returnsSource = readFileSync(join(__dirname, '../services/returns.service.js'), 'utf8');
  const createSlice = returnsSource.slice(
    returnsSource.indexOf('async createForUser('),
    returnsSource.indexOf('async createForGuest(')
  );
  assert.match(createSlice, /assertOrderLineEligibleForReturnType/);

  const afterCreate = returnsSource.slice(returnsSource.indexOf('async createForGuest('));
  assert.equal(
    afterCreate.includes('assertOrderLineEligibleForReturnType'),
    false,
    'product eligibility must not run on existing return processing paths'
  );
});
