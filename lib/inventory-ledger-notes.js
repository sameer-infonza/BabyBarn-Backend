import { formatOrderNumber } from '../utils/order-number.js';

/** Normalize stored orderNumber (BB-000034) or legacy numeric id to display label without # prefix. */
export function formatOrderLedgerLabel(orderNumber, publicId) {
  if (orderNumber) {
    const trimmed = String(orderNumber).trim();
    if (/^BB-\d{6}$/i.test(trimmed)) return trimmed.toUpperCase();
    const n = Number(trimmed);
    if (Number.isFinite(n) && n >= 1) return formatOrderNumber(n);
    return trimmed;
  }
  return publicId || '';
}

export function orderLedgerNote(eventType, orderLabel) {
  const label = orderLabel ? String(orderLabel).replace(/^#/, '') : '';
  const ref = label ? `Order #${label}` : 'order';
  switch (String(eventType || '').toUpperCase()) {
    case 'RESERVE':
      return `Inventory reserved for ${ref}`;
    case 'COMMIT':
      return `Inventory allocated for ${ref}`;
    case 'RELEASE':
      return `Reservation released for ${ref}`;
    case 'REFUND_RESTORE':
      return `Inventory restored after ${ref} was cancelled`;
    case 'RESTOCK':
      return `Inventory restocked for ${ref}`;
    default:
      return null;
  }
}

export function returnLedgerNote(eventType, returnLabel, returnType = 'STANDARD') {
  const label = returnLabel ? String(returnLabel).replace(/^#/, '') : '';
  const ref = label ? `Return #${label}` : 'return';
  switch (String(eventType || '').toUpperCase()) {
    case 'RESTOCK':
      return returnType === 'REFURBISHMENT'
        ? `Inventory returned from Refurbishment Return (${ref})`
        : `Inventory returned from Standard Return (${ref})`;
    default:
      return null;
  }
}

export function refurbLedgerNote(eventType) {
  switch (String(eventType || '').toUpperCase()) {
    case 'RESTOCK':
    case 'IN':
      return 'Inventory added after Refurbishment Approval';
    default:
      return null;
  }
}

export function checkoutLedgerNote(eventType, orderLabel = null) {
  if (orderLabel) {
    const ref = `Order #${String(orderLabel).replace(/^#/, '')}`;
    switch (String(eventType || '').toUpperCase()) {
      case 'RESERVE':
        return `Inventory reserved during checkout for ${ref}`;
      case 'RELEASE':
        return `Checkout reservation released for ${ref}`;
      default:
        return null;
    }
  }
  switch (String(eventType || '').toUpperCase()) {
    case 'RESERVE':
      return 'Inventory reserved during checkout';
    case 'RELEASE':
      return 'Checkout reservation released';
    default:
      return null;
  }
}

export function resolveLedgerNote(row, meta = {}) {
  if (row.note) return row.note;

  const eventType = row.eventType;
  const referenceType = row.referenceType;

  if (referenceType === 'order' && row.referenceId) {
    if (String(row.referenceId).startsWith('pending:')) {
      return checkoutLedgerNote(eventType);
    }
    const orderLabel = formatOrderLedgerLabel(meta.orderNumber, row.referenceId);
    return orderLedgerNote(eventType, orderLabel);
  }

  if (referenceType === 'checkout_intent') {
    const orderLabel = meta.orderNumber
      ? formatOrderLedgerLabel(meta.orderNumber, meta.orderPublicId)
      : null;
    return checkoutLedgerNote(eventType, orderLabel);
  }

  if (referenceType === 'return' && row.referenceId) {
    const returnLabel = meta.returnNumber || row.referenceId;
    return returnLedgerNote(eventType, returnLabel, meta.returnType || 'STANDARD');
  }

  if (referenceType === 'refurbishment_job') {
    return refurbLedgerNote(eventType);
  }

  return null;
}
