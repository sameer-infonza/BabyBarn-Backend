import test from 'node:test';
import assert from 'node:assert/strict';
import { variantAvailableStock, productAvailableStock } from '../services/inventory-reservation.js';

test('variantAvailableStock subtracts reserved units', () => {
  assert.equal(variantAvailableStock({ stock: 10, reservedStock: 3 }), 7);
  assert.equal(variantAvailableStock({ stock: 5, reservedStock: 0 }), 5);
});

test('productAvailableStock sums variant availability', () => {
  const product = {
    stock: 0,
    reservedStock: 0,
    variants: [
      { stock: 4, reservedStock: 1 },
      { stock: 6, reservedStock: 2 },
    ],
  };
  assert.equal(productAvailableStock(product), 7);
});

test('productAvailableStock uses simple product fields when no variants', () => {
  assert.equal(
    productAvailableStock({ stock: 12, reservedStock: 4, variants: [] }),
    8
  );
});
