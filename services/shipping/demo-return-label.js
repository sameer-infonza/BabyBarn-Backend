/**
 * Demo return labels — bypass UPS when SHIPPING_DEMO_RATES or RETURN_LABEL_DEMO is enabled.
 * Mirrors checkout demo rates (see shipping-orchestrator.js).
 */

export function useDemoReturnLabels() {
  if (String(process.env.RETURN_LABEL_DEMO || '').toLowerCase() === 'true') return true;
  if (String(process.env.SHIPPING_DEMO_RATES || '').toLowerCase() === 'true') return true;
  return false;
}

export function isDemoReturnTracking(trackingNumber, carrier) {
  if (String(carrier || '').toLowerCase() === 'demo') return true;
  const t = String(trackingNumber || '');
  return t.startsWith('DEMO-');
}

/** Next refurb return status when admin clicks Sync on a demo tracking number. */
export function demoTrackingNextStatus(currentStatus) {
  if (currentStatus === 'LABEL_GENERATED') return 'IN_TRANSIT';
  if (currentStatus === 'IN_TRANSIT') return 'RECEIVED';
  return null;
}

export function buildDemoReturnLabel(returnPublicId) {
  const suffix = String(returnPublicId || 'return').slice(0, 8).toUpperCase();
  return {
    shippingLabelUrl: '/uploads/demo/return-label.html',
    trackingNumber: `DEMO-1Z999AA1${suffix}`,
    shippingCarrier: 'demo',
    transactionId: `demo-return-${suffix}-${Date.now()}`,
    provider: 'demo',
  };
}
