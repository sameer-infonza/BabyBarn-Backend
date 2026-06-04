import { prisma } from '../lib/prisma.js';
import { config } from '../config/env.js';
import { emailService } from './email.service.js';
import { variantAvailableStock, productAvailableStock } from './inventory-reservation.js';

/** Notify subscribers when a previously out-of-stock SKU becomes available. */
export async function sendBackInStockAlerts() {
  const subs = await prisma.stockAlertSubscription.findMany({
    where: { notifiedAt: null },
    include: {
      user: { select: { email: true, firstName: true, lastName: true } },
      product: { include: { variants: true } },
      productVariant: true,
    },
    take: 100,
  });

  let sent = 0;
  for (const sub of subs) {
    const available = sub.productVariant
      ? variantAvailableStock(sub.productVariant)
      : productAvailableStock(sub.product);
    if (available <= 0) continue;

    const name = [sub.user.firstName, sub.user.lastName].filter(Boolean).join(' ') || 'there';
    try {
      await emailService.sendTemplate({
        to: sub.user.email,
        template: 'back-in-stock',
        context: {
          name,
          productName: sub.product.name,
          actionUrl: `${config.frontend.customerUrl}/products/${sub.product.slug}`,
        },
      });
      await prisma.stockAlertSubscription.update({
        where: { id: sub.id },
        data: { notifiedAt: new Date() },
      });
      sent += 1;
    } catch (err) {
      console.error('[engagement] back-in-stock email failed', sub.user.email, err);
    }
  }
  return { sent, checked: subs.length };
}

/** Notify wishlist users when price dropped vs priceAtAdd. */
export async function sendWishlistPriceDropAlerts() {
  const items = await prisma.wishlistItem.findMany({
    where: { priceAtAdd: { not: null } },
    include: {
      user: { select: { email: true, firstName: true, lastName: true } },
      product: true,
      productVariant: true,
    },
    take: 200,
  });

  let sent = 0;
  for (const item of items) {
    const current =
      item.productVariant?.priceOverride != null
        ? Number(item.productVariant.priceOverride)
        : Number(item.product.price);
    const was = Number(item.priceAtAdd);
    if (!(current < was - 0.009)) continue;

    const name = [item.user.firstName, item.user.lastName].filter(Boolean).join(' ') || 'there';
    try {
      await emailService.sendTemplate({
        to: item.user.email,
        template: 'price-drop',
        context: {
          name,
          productName: item.product.name,
          oldPrice: `$${was.toFixed(2)}`,
          newPrice: `$${current.toFixed(2)}`,
          actionUrl: `${config.frontend.customerUrl}/products/${item.product.slug}`,
        },
      });
      await prisma.wishlistItem.update({
        where: { id: item.id },
        data: { priceAtAdd: current },
      });
      sent += 1;
    } catch (err) {
      console.error('[engagement] price-drop email failed', item.user.email, err);
    }
  }
  return { sent, checked: items.length };
}
