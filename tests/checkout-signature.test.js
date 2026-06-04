import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCheckoutSignature,
  buildCheckoutSignatureFromOrder,
} from '../utils/checkout-signature.js';

test('buildCheckoutSignature is stable for item order', () => {
  const a = buildCheckoutSignature({
    items: [
      { productId: 'b', quantity: 1 },
      { productId: 'a', quantity: 2, variantId: 'v1' },
    ],
    selectedRateId: 'rate-1',
    storeCreditToApply: 5,
    shippingAddress: {
      addressLine1: '1 Main St',
      zipCode: '90210',
      city: 'Beverly Hills',
      state: 'CA',
    },
  });
  const b = buildCheckoutSignature({
    items: [
      { productId: 'a', quantity: 2, variantId: 'v1' },
      { productId: 'b', quantity: 1 },
    ],
    selectedRateId: 'rate-1',
    storeCreditToApply: 5,
    shippingAddress: {
      addressLine1: '1 Main St',
      zipCode: '90210',
      city: 'Beverly Hills',
      state: 'CA',
    },
  });
  assert.equal(a, b);
});

test('buildCheckoutSignatureFromOrder matches request signature', () => {
  const items = [{ productId: 'prod-1', quantity: 1 }];
  const shippingAddress = {
    addressLine1: '9 Oak Ave',
    zipCode: '10001',
    city: 'New York',
    state: 'NY',
  };
  const fromRequest = buildCheckoutSignature({
    items,
    selectedRateId: 'ups-ground',
    storeCreditToApply: 0,
    shippingAddress,
  });
  const fromOrder = buildCheckoutSignatureFromOrder(
    {
      selectedRateId: 'ups-ground',
      storeCreditApplied: 0,
      shippingAddressJson: shippingAddress,
    },
    [{ product: { publicId: 'prod-1' }, productVariant: null, quantity: 1 }]
  );
  assert.equal(fromRequest, fromOrder);
});
