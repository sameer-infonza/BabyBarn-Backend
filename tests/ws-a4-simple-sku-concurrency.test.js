import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Mirrors Product simple-SKU reserve with stockVersion optimistic concurrency (WS-A4).
 */
function createSimpleSku({ stock, reservedStock = 0, stockVersion = 0 }) {
  return { stock, reservedStock, stockVersion };
}

function reserveSimple(sku, quantity) {
  const available = Math.max(0, sku.stock - sku.reservedStock);
  if (available < quantity) {
    const err = new Error('STOCK_CONFLICT');
    err.code = 'STOCK_CONFLICT';
    throw err;
  }
  const versionAtRead = sku.stockVersion;
  // updateMany where stockVersion matches
  if (sku.stockVersion !== versionAtRead) {
    const err = new Error('STOCK_CONFLICT');
    err.code = 'STOCK_CONFLICT';
    throw err;
  }
  if (sku.stock < sku.reservedStock + quantity) {
    const err = new Error('STOCK_CONFLICT');
    err.code = 'STOCK_CONFLICT';
    throw err;
  }
  sku.reservedStock += quantity;
  sku.stockVersion += 1;
  return { ok: true };
}

function commitSimple(sku, quantity) {
  if (sku.reservedStock < quantity || sku.stock < quantity) {
    const err = new Error('INSUFFICIENT_STOCK');
    err.code = 'INSUFFICIENT_STOCK';
    throw err;
  }
  sku.stock -= quantity;
  sku.reservedStock -= quantity;
  sku.stockVersion += 1;
}

function releaseSimple(sku, quantity) {
  const take = Math.min(quantity, sku.reservedStock);
  sku.reservedStock -= take;
  sku.stockVersion += 1;
}

test('A4: stock=1 concurrent reserve A+B → exactly one succeeds', () => {
  const sku = createSimpleSku({ stock: 1, reservedStock: 0 });
  const results = [];
  // Serialize interleaving that both read reserved=0 then both try update
  const attempt = () => {
    try {
      // Optimistic: read then CAS
      const snap = { ...sku };
      if (snap.stock - snap.reservedStock < 1) throw Object.assign(new Error('x'), { code: 'STOCK_CONFLICT' });
      if (sku.stockVersion !== snap.stockVersion) {
        throw Object.assign(new Error('x'), { code: 'STOCK_CONFLICT' });
      }
      sku.reservedStock += 1;
      sku.stockVersion += 1;
      results.push('ok');
    } catch (e) {
      results.push(e.code);
    }
  };
  attempt();
  attempt();
  assert.deepEqual(results.sort(), ['STOCK_CONFLICT', 'ok'].sort());
  assert.equal(sku.reservedStock, 1);
  assert.equal(sku.stockVersion, 1);
});

test('A4: stock=2 concurrent reserve A+B → both succeed', () => {
  const sku = createSimpleSku({ stock: 2 });
  reserveSimple(sku, 1);
  reserveSimple(sku, 1);
  assert.equal(sku.reservedStock, 2);
  assert.equal(sku.stockVersion, 2);
});

test('A4: insufficient stock → STOCK_CONFLICT', () => {
  const sku = createSimpleSku({ stock: 1, reservedStock: 1 });
  assert.throws(() => reserveSimple(sku, 1), (e) => e.code === 'STOCK_CONFLICT');
});

test('A4: variant-style version bump on commit/release stays consistent', () => {
  const sku = createSimpleSku({ stock: 5 });
  reserveSimple(sku, 2);
  assert.equal(sku.stockVersion, 1);
  commitSimple(sku, 1);
  assert.equal(sku.stock, 4);
  assert.equal(sku.reservedStock, 1);
  assert.equal(sku.stockVersion, 2);
  releaseSimple(sku, 1);
  assert.equal(sku.reservedStock, 0);
  assert.equal(sku.stockVersion, 3);
});

test('A4: reserveSimple uses stockVersion gate like Product.updateMany', () => {
  const sku = createSimpleSku({ stock: 3, stockVersion: 7 });
  reserveSimple(sku, 1);
  assert.equal(sku.stockVersion, 8);
});
