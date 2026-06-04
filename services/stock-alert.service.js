import { prisma } from '../lib/prisma.js';
import { AppError } from '../utils/error-handler.js';
import { variantAvailableStock, productAvailableStock } from './inventory-reservation.js';

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
      if (variantAvailableStock(v) > 0) {
        throw new AppError(400, 'This variant is already in stock');
      }
    } else if (productAvailableStock(product) > 0) {
      throw new AppError(400, 'This product is already in stock');
    }

    const existing = await prisma.stockAlertSubscription.findFirst({
      where: {
        userId: user.id,
        productId: product.id,
        productVariantId: variantDbId,
      },
    });
    if (existing) {
      await prisma.stockAlertSubscription.update({
        where: { id: existing.id },
        data: { notifiedAt: null },
      });
    } else {
      await prisma.stockAlertSubscription.create({
        data: {
          userId: user.id,
          productId: product.id,
          productVariantId: variantDbId,
        },
      });
    }

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
