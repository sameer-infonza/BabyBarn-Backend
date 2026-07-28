import { prisma } from '../lib/prisma.js';
import { notifyProductBackInStock } from './stock-alert.service.js';

/** Notify subscribers when a previously out-of-stock SKU becomes available. */
export async function sendBackInStockAlerts() {
  return notifyProductBackInStock(null);
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
      const { emailService } = await import('./email.service.js');
      const { config } = await import('../config/env.js');
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
