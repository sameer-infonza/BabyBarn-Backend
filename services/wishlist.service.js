import { prisma } from '../lib/prisma.js';
import { AppError } from '../utils/error-handler.js';

export class WishlistService {
  async listForUser(userPublicId) {
    const user = await prisma.user.findUnique({
      where: { publicId: userPublicId },
      select: { id: true },
    });
    if (!user) throw new AppError(401, 'Unauthorized');

    const rows = await prisma.wishlistItem.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
      include: {
        product: {
          select: {
            publicId: true,
            name: true,
            slug: true,
            price: true,
            memberPrice: true,
            imageUrl: true,
            stock: true,
            reservedStock: true,
            productType: true,
            variants: { select: { publicId: true, stock: true, reservedStock: true, priceOverride: true } },
          },
        },
        productVariant: {
          select: { publicId: true, sku: true, stock: true, reservedStock: true, combination: true, priceOverride: true },
        },
      },
    });

    return rows.map((row) => ({
      productId: row.product.publicId,
      variantId: row.productVariant?.publicId ?? null,
      priceAtAdd: row.priceAtAdd,
      addedAt: row.createdAt,
      product: row.product,
      variant: row.productVariant,
    }));
  }

  async syncForUser(userPublicId, items) {
    const user = await prisma.user.findUnique({
      where: { publicId: userPublicId },
      select: { id: true },
    });
    if (!user) throw new AppError(401, 'Unauthorized');

    const normalized = [];
    for (const item of items) {
      const product = await prisma.product.findUnique({
        where: { publicId: item.productId },
        include: { variants: true },
      });
      if (!product || product.isDraft) continue;

      let variantDbId = null;
      let priceAtAdd = product.price;
      if (item.variantId) {
        const v = product.variants.find((x) => x.publicId === item.variantId);
        if (!v) continue;
        variantDbId = v.id;
        priceAtAdd = v.priceOverride ?? product.price;
      }

      normalized.push({
        userId: user.id,
        productId: product.id,
        productVariantId: variantDbId,
        priceAtAdd,
      });
    }

    await prisma.$transaction([
      prisma.wishlistItem.deleteMany({ where: { userId: user.id } }),
      ...(normalized.length
        ? [
            prisma.wishlistItem.createMany({
              data: normalized,
              skipDuplicates: true,
            }),
          ]
        : []),
    ]);

    return this.listForUser(userPublicId);
  }

  async toggle(userPublicId, productPublicId, variantPublicId = null) {
    const user = await prisma.user.findUnique({
      where: { publicId: userPublicId },
      select: { id: true },
    });
    if (!user) throw new AppError(401, 'Unauthorized');

    const product = await prisma.product.findUnique({
      where: { publicId: productPublicId },
      include: { variants: true },
    });
    if (!product || product.isDraft) throw new AppError(404, 'Product not found');

    let variantDbId = null;
    let priceAtAdd = product.price;
    if (variantPublicId) {
      const v = product.variants.find((x) => x.publicId === variantPublicId);
      if (!v) throw new AppError(404, 'Variant not found');
      variantDbId = v.id;
      priceAtAdd = v.priceOverride ?? product.price;
    }

    const existing = await prisma.wishlistItem.findFirst({
      where: {
        userId: user.id,
        productId: product.id,
        productVariantId: variantDbId,
      },
    });

    if (existing) {
      await prisma.wishlistItem.delete({ where: { id: existing.id } });
      return { wishlisted: false };
    }

    await prisma.wishlistItem.create({
      data: {
        userId: user.id,
        productId: product.id,
        productVariantId: variantDbId,
        priceAtAdd,
      },
    });
    return { wishlisted: true };
  }
}

export const wishlistService = new WishlistService();
