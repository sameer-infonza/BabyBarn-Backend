import { prisma } from '../lib/prisma.js';
import { AppError } from '../utils/error-handler.js';
import { productAvailableStock, variantAvailableStock } from './inventory-reservation.js';
import { isSellableAvailable } from '../lib/inventory-stock-rules.js';
import { maybeAutoSubscribeWishlistRestock } from './stock-alert.service.js';

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
            isDraft: true,
            isActiveListing: true,
            inventoryModel: true,
            variants: {
              select: {
                publicId: true,
                stock: true,
                reservedStock: true,
                priceOverride: true,
              },
            },
          },
        },
        productVariant: {
          select: {
            publicId: true,
            sku: true,
            stock: true,
            reservedStock: true,
            combination: true,
            priceOverride: true,
          },
        },
      },
    });

    return rows
      .filter((row) => row.product && !row.product.isDraft && row.product.isActiveListing)
      .map((row) => this.toPublicRow(row));
  }

  toPublicRow(row) {
    const available = row.productVariant
      ? variantAvailableStock(row.productVariant)
      : productAvailableStock(row.product);
    const currentPrice =
      row.productVariant?.priceOverride != null
        ? Number(row.productVariant.priceOverride)
        : Number(row.product.price);
    return {
      productId: row.product.publicId,
      variantId: row.productVariant?.publicId ?? null,
      name: row.product.name,
      slug: row.product.slug,
      imageUrl: row.product.imageUrl,
      condition: row.product.productType === 'REFURBISHED' ? 'REFURBISHED' : 'NEW',
      currentPrice,
      memberPrice: row.product.memberPrice != null ? Number(row.product.memberPrice) : null,
      available,
      inStock: isSellableAvailable(available, row.product.productType),
      priceAtAdd: row.priceAtAdd != null ? Number(row.priceAtAdd) : null,
      addedAt: row.createdAt,
    };
  }

  async syncForUser(userPublicId, items) {
    const user = await prisma.user.findUnique({
      where: { publicId: userPublicId },
      select: { id: true },
    });
    if (!user) throw new AppError(401, 'Unauthorized');

    const normalized = [];
    const autoSubscribe = [];
    for (const item of items) {
      const product = await prisma.product.findUnique({
        where: { publicId: item.productId },
        include: { variants: true },
      });
      if (!product || product.isDraft || !product.isActiveListing) continue;

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
      autoSubscribe.push({ product, variantDbId });
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

    for (const row of autoSubscribe) {
      await maybeAutoSubscribeWishlistRestock(user.id, row.product, row.variantDbId);
    }

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

    await maybeAutoSubscribeWishlistRestock(user.id, product, variantDbId);

    return { wishlisted: true };
  }

  async moveToCart(userPublicId, productPublicId, variantPublicId = null) {
    const user = await prisma.user.findUnique({
      where: { publicId: userPublicId },
      select: { id: true },
    });
    if (!user) throw new AppError(401, 'Unauthorized');

    const product = await prisma.product.findUnique({
      where: { publicId: productPublicId },
      include: { variants: true },
    });
    if (!product) throw new AppError(404, 'Product not found');

    let variantDbId = null;
    if (variantPublicId) {
      const variant = product.variants.find((row) => row.publicId === variantPublicId);
      if (!variant) throw new AppError(404, 'Variant not found');
      variantDbId = variant.id;
    }

    const existing = await prisma.wishlistItem.findFirst({
      where: { userId: user.id, productId: product.id, productVariantId: variantDbId },
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
            isDraft: true,
            isActiveListing: true,
            inventoryModel: true,
          },
        },
        productVariant: {
          select: {
            publicId: true,
            stock: true,
            reservedStock: true,
            priceOverride: true,
          },
        },
      },
    });
    if (!existing) throw new AppError(404, 'Wishlist item not found');

    await prisma.wishlistCartMove.upsert({
      where: { userId_productId: { userId: user.id, productId: product.id } },
      create: { userId: user.id, productId: product.id },
      update: {},
    });
    await prisma.wishlistItem.delete({ where: { id: existing.id } });
    return this.toPublicRow(existing);
  }
}

export const wishlistService = new WishlistService();
