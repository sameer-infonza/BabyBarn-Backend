/**
 * Pure cancellation money breakdown shared by preview + finalizeOrderCancellation.
 * Full cancel: Stripe refunds remaining card total (includes shipping); store credit restored to wallet.
 * Partial cancel: merchandise + proportional tax − proportional store-credit share (shipping stays).
 */

export function moneyRound(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

/**
 * @param {object} order — prisma order with orderItems
 * @param {{ itemPublicIds?: string[]|null }} [opts]
 */
export function computeOrderCancellationBreakdown(order, { itemPublicIds = null } = {}) {
  const activeLines = (order.orderItems || []).filter((line) => !line.cancelledAt);
  if (activeLines.length === 0) {
    return {
      ok: false,
      code: 'ALREADY_CANCELLED',
      message: 'All items on this order are already cancelled',
    };
  }

  let linesToCancel = activeLines;
  if (Array.isArray(itemPublicIds) && itemPublicIds.length > 0) {
    const wanted = new Set(itemPublicIds.map(String));
    linesToCancel = activeLines.filter((line) => wanted.has(String(line.publicId)));
    if (linesToCancel.length === 0) {
      return {
        ok: false,
        code: 'NO_MATCHING_ITEMS',
        message: 'No matching active items to cancel',
      };
    }
    const unknown = [...wanted].filter((id) => !activeLines.some((l) => String(l.publicId) === id));
    if (unknown.length > 0) {
      return {
        ok: false,
        code: 'UNKNOWN_ITEMS',
        message: 'One or more selected items are not on this order or already cancelled',
      };
    }
  }

  const cancellingAll = linesToCancel.length === activeLines.length;
  const isPaid =
    order.paymentStatus === 'PAID' || order.paymentStatus === 'PARTIALLY_REFUNDED';

  const merchandiseSubtotal = moneyRound(
    activeLines.reduce((sum, line) => sum + Number(line.price) * Number(line.quantity), 0)
  );
  const productAmount = moneyRound(
    linesToCancel.reduce((sum, line) => sum + Number(line.price) * Number(line.quantity), 0)
  );
  const shippingCost = moneyRound(Number(order.shippingCost) || 0);
  const storeCreditOnOrder = moneyRound(Math.max(0, Number(order.storeCreditApplied) || 0));
  const taxOnOrder = moneyRound(Math.max(0, Number(order.taxAmount) || 0));
  const orderTotal = moneyRound(Number(order.totalAmount) || 0);

  const storeCreditRestore =
    cancellingAll || merchandiseSubtotal <= 0
      ? storeCreditOnOrder
      : moneyRound(storeCreditOnOrder * (productAmount / merchandiseSubtotal));
  const taxRefund =
    cancellingAll || merchandiseSubtotal <= 0
      ? taxOnOrder
      : moneyRound(taxOnOrder * (productAmount / merchandiseSubtotal));

  // Shipping refunded only on full cancel of a paid order (included in card total).
  const shippingRefund = cancellingAll && isPaid ? shippingCost : 0;

  let stripeRefundAmount = 0;
  if (cancellingAll && isPaid) {
    stripeRefundAmount = Math.max(0, orderTotal);
  } else if (isPaid) {
    stripeRefundAmount = Math.max(0, moneyRound(productAmount + taxRefund - storeCreditRestore));
  }

  const lines = linesToCancel.map((line) => ({
    id: line.publicId,
    name: line.product?.name || 'Product',
    quantity: Number(line.quantity) || 0,
    unitPrice: moneyRound(Number(line.price) || 0),
    lineTotal: moneyRound(Number(line.price) * Number(line.quantity)),
  }));

  const customerReceivesTotal = moneyRound(stripeRefundAmount + storeCreditRestore);

  return {
    ok: true,
    cancellingAll,
    isPaid,
    paymentStatus: order.paymentStatus || null,
    orderStatus: order.status || null,
    lines,
    productAmount,
    shippingCost,
    shippingRefund,
    taxAmount: taxOnOrder,
    taxRefund,
    storeCreditApplied: storeCreditOnOrder,
    storeCreditRestore,
    orderTotal,
    stripeRefundAmount,
    customerReceivesTotal,
    /** Destinations for UI copy */
    destinations: {
      stripe: isPaid && stripeRefundAmount > 0 ? stripeRefundAmount : 0,
      storeCredit: storeCreditRestore > 0 ? storeCreditRestore : 0,
      unpaidRelease: !isPaid,
    },
    notes: [
      !isPaid
        ? 'Order is unpaid — payment holds and any store-credit hold will be released; no Stripe refund.'
        : null,
      cancellingAll && isPaid && shippingCost > 0
        ? 'Full cancellation includes shipping in the Stripe refund.'
        : null,
      !cancellingAll && shippingCost > 0
        ? 'Partial cancellation does not refund shipping.'
        : null,
      storeCreditRestore > 0
        ? 'Store credit used on this order is restored to the customer wallet (not refunded to the card).'
        : null,
    ].filter(Boolean),
  };
}
