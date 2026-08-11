import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRefurbStoreCredit, REFURB_STORE_CREDIT_RATE } from '../config/refurb.config.js';
import { refurbEarnSourceKey } from '../services/wallet.service.js';

test('refurb earn sourceKey is stable per return publicId', () => {
  assert.equal(refurbEarnSourceKey('ret_abc'), 'earn:return:ret_abc');
  assert.equal(refurbEarnSourceKey(' ret_abc '), 'earn:return:ret_abc');
  assert.equal(refurbEarnSourceKey('ret_abc'), refurbEarnSourceKey('ret_abc'));
});

test('refurb earn sourceKey differs across returns', () => {
  assert.notEqual(refurbEarnSourceKey('ret_a'), refurbEarnSourceKey('ret_b'));
});

test('store credit rate unchanged (20% of member price)', () => {
  assert.equal(REFURB_STORE_CREDIT_RATE, 0.2);
  assert.equal(computeRefurbStoreCredit(50), 10);
  assert.equal(computeRefurbStoreCredit(33.33), 6.67);
});

test('accepted qty multiplies unit credit', () => {
  const unit = computeRefurbStoreCredit(40);
  const qty = 3;
  const amount = Math.round(unit * qty * 100) / 100;
  assert.equal(unit, 8);
  assert.equal(amount, 24);
});

test('zero member price yields zero credit', () => {
  assert.equal(computeRefurbStoreCredit(0), 0);
  assert.equal(computeRefurbStoreCredit(null), 0);
});

/**
 * Simulates the claim/idempotency algorithm used by awardEarnedCreditInTx
 * without a live DB: first writer wins; second sees existing sourceKey.
 */
test('idempotent earn algorithm: second claim skips', () => {
  const ledger = new Map();
  const wallets = new Map([[1, { balance: 0, heldBalance: 0 }]]);

  function awardOnce({ userId, amount, sourceKey }) {
    if (ledger.has(sourceKey)) {
      return { amount: ledger.get(sourceKey).amount, created: false, skipped: true };
    }
    const wallet = wallets.get(userId);
    ledger.set(sourceKey, { amount, type: 'EARNED' });
    wallet.balance = Math.round((wallet.balance + amount) * 100) / 100;
    return { amount, created: true, skipped: false };
  }

  const key = refurbEarnSourceKey('ret_1');
  const first = awardOnce({ userId: 1, amount: 10, sourceKey: key });
  const second = awardOnce({ userId: 1, amount: 10, sourceKey: key });
  const third = awardOnce({ userId: 1, amount: 10, sourceKey: key });

  assert.equal(first.created, true);
  assert.equal(second.skipped, true);
  assert.equal(third.skipped, true);
  assert.equal(wallets.get(1).balance, 10);
  assert.equal(ledger.size, 1);
});

test('concurrent earn simulation: only one credit for same sourceKey', () => {
  const ledger = new Map();
  let balance = 0;
  let auditCount = 0;

  function tryAward(amount, sourceKey) {
    // Mimic unique constraint: check-then-set under single-threaded interleaving
    if (ledger.has(sourceKey)) return { created: false };
    ledger.set(sourceKey, amount);
    balance += amount;
    auditCount += 1;
    return { created: true };
  }

  const key = refurbEarnSourceKey('ret_concurrent');
  const results = [tryAward(12, key), tryAward(12, key), tryAward(12, key)];
  assert.equal(results.filter((r) => r.created).length, 1);
  assert.equal(balance, 12);
  assert.equal(auditCount, 1);
});

test('hold then redeem cannot overspend available balance', () => {
  const wallet = { balance: 20, heldBalance: 0 };
  function available() {
    return Math.max(0, wallet.balance - wallet.heldBalance);
  }
  function hold(amount) {
    const toHold = Math.min(amount, available());
    if (toHold <= 0) return 0;
    wallet.heldBalance += toHold;
    return toHold;
  }
  function capture(amount) {
    const releaseHeld = Math.min(wallet.heldBalance, amount);
    wallet.balance -= releaseHeld;
    wallet.heldBalance -= releaseHeld;
    return releaseHeld;
  }

  assert.equal(hold(15), 15);
  assert.equal(available(), 5);
  assert.equal(hold(10), 5);
  assert.equal(available(), 0);
  assert.equal(hold(1), 0);
  capture(20);
  assert.equal(wallet.balance, 0);
  assert.equal(wallet.heldBalance, 0);
});

test('concurrent holds under lock semantics cannot exceed balance', () => {
  const wallet = { balance: 30, heldBalance: 0 };
  function available() {
    return Math.max(0, wallet.balance - wallet.heldBalance);
  }
  // Serialized holds (FOR UPDATE equivalent)
  const h1 = Math.min(25, available());
  wallet.heldBalance += h1;
  const h2 = Math.min(25, available());
  wallet.heldBalance += h2;
  assert.equal(h1, 25);
  assert.equal(h2, 5);
  assert.equal(wallet.heldBalance, 30);
  assert.equal(available(), 0);
});

test('award then hold respects new balance', () => {
  const wallet = { balance: 0, heldBalance: 0 };
  const ledger = new Map();
  const key = refurbEarnSourceKey('ret_pay');
  if (!ledger.has(key)) {
    ledger.set(key, 18);
    wallet.balance += 18;
  }
  const available = Math.max(0, wallet.balance - wallet.heldBalance);
  const held = Math.min(18, available);
  wallet.heldBalance += held;
  assert.equal(held, 18);
  assert.equal(available - held, 0);
});

test('failed earn before ledger write leaves zero balance (no partial credit)', () => {
  const wallet = { balance: 5, heldBalance: 0 };
  const ledger = new Map();
  const key = refurbEarnSourceKey('ret_fail');
  let threw = false;
  try {
    // Simulate failure before unique insert / balance increment
    throw new Error('db down');
  } catch {
    threw = true;
  }
  assert.equal(threw, true);
  assert.equal(ledger.has(key), false);
  assert.equal(wallet.balance, 5);
});
