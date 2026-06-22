import { prisma } from '../lib/prisma.js';

/** Guest PII is purged this many days after the guest's most recent order. */
export const GUEST_RETENTION_DAYS = Number(process.env.GUEST_RETENTION_DAYS ?? 21);

/**
 * Purge personally identifiable information for stale guest accounts.
 *
 * A guest qualifies when it is an unconverted guest, has not already been purged,
 * and its most recent order is older than the retention window. We keep firstName,
 * lastName and email (for marketing) and strip the rest of the PII: phone, saved
 * addresses, and the contact/shipping/billing details captured on their orders.
 */
export async function purgeExpiredGuestData() {
  const cutoff = new Date(Date.now() - GUEST_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const candidates = await prisma.user.findMany({
    where: {
      isGuest: true,
      convertedAt: null,
      guestPurgedAt: null,
    },
    select: {
      id: true,
      orders: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { createdAt: true },
      },
    },
  });

  const expiredUserIds = candidates
    .filter((u) => {
      const latest = u.orders[0]?.createdAt;
      // No orders at all: fall back to never purging here (handled elsewhere if needed).
      if (!latest) return false;
      return new Date(latest) < cutoff;
    })
    .map((u) => u.id);

  if (expiredUserIds.length === 0) {
    return { scanned: candidates.length, purged: 0 };
  }

  let purged = 0;
  for (const userId of expiredUserIds) {
    await prisma.$transaction([
      prisma.address.deleteMany({ where: { userId } }),
      prisma.order.updateMany({
        where: { userId },
        data: {
          contactPhone: null,
          shippingAddressJson: null,
          billingAddressJson: null,
        },
      }),
      prisma.user.update({
        where: { id: userId },
        data: {
          phone: null,
          membershipShippingAddressJson: null,
          guestPurgedAt: new Date(),
        },
      }),
    ]);
    purged += 1;
  }

  return { scanned: candidates.length, purged };
}
