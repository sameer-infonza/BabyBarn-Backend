/**
 * Stable fingerprint for checkout cart + delivery + rate + credit.
 * Used to reuse one pending order per checkout attempt (not one per PI API call).
 */
export function buildCheckoutSignature({
  items,
  selectedRateId,
  storeCreditToApply,
  shippingAddress,
  includeAccessMembership,
  babyName,
}) {
  const normalizedItems = [...items]
    .map((item) => [item.productId, item.variantId || '', item.quantity])
    .sort((a, b) => {
      const c = String(a[0]).localeCompare(String(b[0]));
      return c !== 0 ? c : String(a[1]).localeCompare(String(b[1]));
    });

  const ship = shippingAddress
    ? [
        shippingAddress.addressLine1,
        shippingAddress.zipCode || shippingAddress.postalCode,
        shippingAddress.city,
        shippingAddress.state,
      ].map((s) => String(s || '').trim().toLowerCase())
    : [];

  return JSON.stringify({
    items: normalizedItems,
    rate: selectedRateId || '',
    credit: Number(storeCreditToApply || 0).toFixed(2),
    ship,
    access: includeAccessMembership ? '1' : '0',
    baby: String(babyName || '').trim().toLowerCase(),
  });
}

export function buildCheckoutSignatureFromOrder(order, orderItems) {
  const items = orderItems
    .map((line) => [
      line.product.publicId,
      line.productVariant?.publicId || '',
      line.quantity,
    ])
    .sort((a, b) => {
      const c = String(a[0]).localeCompare(String(b[0]));
      return c !== 0 ? c : String(a[1]).localeCompare(String(b[1]));
    });

  const shipAddr = order.shippingAddressJson;
  const ship = shipAddr
    ? [
        shipAddr.addressLine1,
        shipAddr.zipCode || shipAddr.postalCode,
        shipAddr.city,
        shipAddr.state,
      ].map((s) => String(s || '').trim().toLowerCase())
    : [];

  return JSON.stringify({
    items,
    rate: order.selectedRateId || '',
    credit: Number(order.storeCreditApplied || 0).toFixed(2),
    ship,
    access: order.includeAccessMembership ? '1' : '0',
    baby: String(order.membershipBabyName || '').trim().toLowerCase(),
  });
}
