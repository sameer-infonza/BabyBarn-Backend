import { prisma } from '../../lib/prisma.js';
import { defaultParcel, sanitizeParcel } from './shipping-address.js';

const LB_PER_ITEM = 0.5;

async function platformDefaultParcel() {
  const row = await prisma.shippingSettings.findUnique({ where: { id: 1 } });
  const pkg = row?.defaultPackageJson;
  if (pkg && typeof pkg === 'object') {
    return sanitizeParcel({
      length: pkg.length ?? '10',
      width: pkg.width ?? '8',
      height: pkg.height ?? '4',
      weight: pkg.weight ?? '1',
      distance_unit: pkg.distance_unit ?? 'in',
      mass_unit: pkg.mass_unit ?? 'lb',
    });
  }
  return sanitizeParcel(defaultParcel());
}

/**
 * Estimate outbound parcel from order line items + admin default package dimensions.
 */
export async function buildParcelsForOrder(order) {
  const base = await platformDefaultParcel();
  const items = order.orderItems || [];
  const units = items.reduce((sum, line) => sum + Math.max(1, Number(line.quantity) || 1), 0);
  const weightLb = Math.max(0.1, units * LB_PER_ITEM);
  const parcel = {
    ...base,
    weight: String(Math.max(Number(base.weight) || 1, weightLb).toFixed(2)),
  };
  return [parcel];
}
