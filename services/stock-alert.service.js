import { prisma } from '../lib/prisma.js';
import { AppError } from '../utils/error-handler.js';
import { config } from '../config/env.js';
import { emailService } from './email.service.js';
import { variantAvailableStock, productAvailableStock } from './inventory-reservation.js';
import { isSellableAvailable } from '../lib/inventory-stock-rules.js';
import { normalizeNotificationPrefs } from '../lib/notification-prefs.js';

/**
 * Upsert a pending stock-alert subscription (resets notifiedAt so the next
 * restock can email again). Used by explicit "Notify me" and by wishlist
 * auto-subscribe for out-of-stock NEW products.
 */
export async function ensurePendingStockAlert(userId, productId, productVariantId = null) {
  const existing = await prisma.stockAlertSubscription.findFirst({
    where: {
      userId,
      productId,
      productVariantId,
    },
  });
  if (existing) {
    if (existing.notifiedAt != null) {
      await prisma.stockAlertSubscription.update({
        where: { id: existing.id },
        data: { notifiedAt: null },
      });
    }
    return existing.id;
  }
  const created = await prisma.stockAlertSubscription.create({
    data: {
      userId,
      productId,
      productVariantId,
    },
  });
  return created.id;
}

/**
 * When a NEW product is wishlisted while out of stock, enroll the shopper in
 * restock alerts automatically.
 */
export async function maybeAutoSubscribeWishlistRestock(userId, product, productVariantId = null) {
  if (!product || product.productType !== 'NEW' || product.isDraft) return;
  const available = productVariantId
    ? variantAvailableStock(product.variants?.find((v) => v.id === productVariantId) || { stock: 0, reservedStock: 0 })
    : productAvailableStock(product);
  if (isSellableAvailable(available, 'NEW')) return;
  await ensurePendingStockAlert(userId, product.id, productVariantId);
}

function availableForSubscription(sub) {
  if (sub.productVariant) return variantAvailableStock(sub.productVariant);
  return productAvailableStock(sub.product);
}

/**
 * Email pending subscribers when a product / variant is sellable again.
 *
 * @param {number|null} productDbId
 *   - When set (inventory restock hook): also enroll current wishlist holders
 *     of that NEW product so they get the restock email without a separate
 *     "Notify me" click, then send pending alerts for that product only.
 *   - When null (cron): only send existing pending subscriptions that are
 *     now sellable; also enroll wishlist holders of still-OOS NEW products
 *     so they are ready for the next restock.
 */
export async function notifyProductBackInStock(productDbId = null) {
  if (productDbId != null) {
    const product = await prisma.product.findUnique({
      where: { id: productDbId },
      include: { variants: true },
    });
    if (product && product.productType === 'NEW' && !product.isDraft) {
      const available = productAvailableStock(product);
      if (isSellableAvailable(available, 'NEW')) {
        const wishlistRows = await prisma.wishlistItem.findMany({
          where: { productId: productDbId },
          select: { userId: true, productId: true, productVariantId: true },
          take: 500,
        });
        for (const row of wishlistRows) {
          await ensurePendingStockAlert(row.userId, row.productId, row.productVariantId ?? null);
        }
      }
    }
  } else {
    // Cron: keep OOS wishlist holders enrolled so the next restock can email them.
    const oosWishlist = await prisma.wishlistItem.findMany({
      where: {
        product: {
          productType: 'NEW',
          isDraft: false,
          isActiveListing: true,
        },
      },
      include: {
        product: { include: { variants: true } },
        productVariant: true,
      },
      take: 300,
    });
    for (const row of oosWishlist) {
      const available = row.productVariant
        ? variantAvailableStock(row.productVariant)
        : productAvailableStock(row.product);
      if (!isSellableAvailable(available, 'NEW')) {
        await ensurePendingStockAlert(row.userId, row.productId, row.productVariantId ?? null);
      }
    }
  }

  const subs = await prisma.stockAlertSubscription.findMany({
    where: {
      notifiedAt: null,
      ...(productDbId != null ? { productId: productDbId } : {}),
    },
    include: {
      user: {
        select: {
          email: true,
          firstName: true,
          lastName: true,
          notificationPrefs: true,
        },
      },
      product: { include: { variants: true } },
      productVariant: true,
    },
    take: productDbId != null ? 500 : 100,
  });

  let sent = 0;
  for (const sub of subs) {
    if (sub.product.isDraft || !sub.product.isActiveListing) continue;
    if (!isSellableAvailable(availableForSubscription(sub), sub.product.productType)) continue;

    const prefs = normalizeNotificationPrefs(sub.user.notificationPrefs);
    if (!prefs.restockAlerts) continue;

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
      console.error('[stock-alert] back-in-stock email failed', sub.user.email, err);
    }
  }
  return { sent, checked: subs.length };
}

export class StockAlertService {
  async subscribe(userPublicId, productPublicId, variantPublicId = null) {
    const user = await prisma.user.findUnique({
      where: { publicId: userPublicId },
      select: { id: true, email: true, firstName: true },
    });
    if (!user) throw new AppError(401, 'Unauthorized');

    const product = await prisma.product.findUnique({
      where: { publicId: productPublicId },
      include: { variants: true },
    });
    if (!product || product.isDraft) throw new AppError(404, 'Product not found');

    let variantDbId = null;
    if (variantPublicId) {
      const v = product.variants.find((x) => x.publicId === variantPublicId);
      if (!v) throw new AppError(404, 'Variant not found');
      variantDbId = v.id;
      if (isSellableAvailable(variantAvailableStock(v), product.productType)) {
        throw new AppError(400, 'This variant is already in stock');
      }
    } else if (isSellableAvailable(productAvailableStock(product), product.productType)) {
      throw new AppError(400, 'This product is already in stock');
    }

    await ensurePendingStockAlert(user.id, product.id, variantDbId);
    return { subscribed: true };
  }

  async listForUser(userPublicId) {
    const user = await prisma.user.findUnique({
      where: { publicId: userPublicId },
      select: { id: true },
    });
    if (!user) throw new AppError(401, 'Unauthorized');
    return prisma.stockAlertSubscription.findMany({
      where: { userId: user.id },
      include: {
        product: { select: { publicId: true, name: true, slug: true } },
        productVariant: { select: { publicId: true, sku: true } },
      },
    });
  }
}

export const stockAlertService = new StockAlertService();
