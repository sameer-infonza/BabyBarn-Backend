import { PrismaClient } from '@prisma/client';
import { AppError } from '../utils/error-handler.js';

const prisma = new PrismaClient();

export const LOW_STOCK_THRESHOLD = 10;

export function computeTotalStock(product) {
  const variants = product.variants ?? [];
  if (variants.length > 0) {
    return variants.reduce((s, v) => s + v.stock, 0);
  }
  return product.stock;
}

/** Validates aggregate stock without mutating (for unpaid checkout orders). */
export function assertStockAvailable(product, quantity) {
  const total = computeTotalStock(product);
  if (total < quantity) {
    throw new AppError(400, `Insufficient stock for "${product.name}"`);
  }
}

export function stockStatusFromTotal(total) {
  if (total <= 0) return 'out_of_stock';
  if (total <= LOW_STOCK_THRESHOLD) return 'low_stock';
  return 'in_stock';
}

export function combinationLabel(combination) {
  if (!combination || typeof combination !== 'object') return '—';
  const entries = Object.entries(combination);
  if (entries.length === 0) return '—';
  return entries.map(([k, val]) => `${k}: ${String(val)}`).join(' · ');
}

export async function syncParentStockFromVariants(tx, productId) {
  const sum = await tx.productVariant.aggregate({
    where: { productId },
    _sum: { stock: true },
  });
  await tx.product.update({
    where: { id: productId },
    data: { stock: sum._sum.stock ?? 0 },
  });
}

/**
 * Manual inventory adjustment: one variant SKU or simple product stock only.
 */
async function adjustManualStock(tx, product, userId, { variantPublicId, delta, reason }) {
  const variants = await tx.productVariant.findMany({
    where: { productId: product.id },
    orderBy: { sortOrder: 'asc' },
  });

  if (variants.length === 0) {
    if (variantPublicId) {
      throw new AppError(400, 'This product has no variants');
    }
    if (product.stock + delta < 0) {
      throw new AppError(400, 'Stock cannot go below 0');
    }
    const next = Math.max(0, product.stock + delta);
    const applied = next - product.stock;
    await tx.product.update({
      where: { id: product.id },
      data: { stock: next },
    });
    await tx.inventoryAdjustment.create({
      data: {
        productId: product.id,
        userId,
        quantityChange: applied,
        reason: reason?.trim() || null,
        productVariantId: null,
      },
    });
    return { applied, variantPublicId: null };
  }

  if (!variantPublicId) {
    throw new AppError(
      400,
      'This product has variants — open a variant row and adjust stock for that SKU.'
    );
  }

  const v = variants.find((x) => x.publicId === variantPublicId);
  if (!v) {
    throw new AppError(404, 'Variant not found');
  }
  if (v.stock + delta < 0) {
    throw new AppError(400, 'Stock cannot go below 0');
  }
  const next = Math.max(0, v.stock + delta);
  const applied = next - v.stock;
  await tx.productVariant.update({
    where: { id: v.id },
    data: { stock: next },
  });
  await syncParentStockFromVariants(tx, product.id);

  await tx.inventoryAdjustment.create({
    data: {
      productId: product.id,
      userId,
      quantityChange: applied,
      reason: reason?.trim() || null,
      productVariantId: v.id,
    },
  });

  return { applied, variantPublicId: v.publicId };
}

/**
 * Order checkout: take quantity from aggregate (variants first in sort order, then parent for simple).
 */
export async function decrementOrderStockFromProduct(tx, product, quantity) {
  const variants = await tx.productVariant.findMany({
    where: { productId: product.id },
    orderBy: { sortOrder: 'asc' },
  });

  if (variants.length === 0) {
    const next = product.stock - quantity;
    if (next < 0) {
      throw new AppError(400, `Insufficient stock for "${product.name}"`);
    }
    await tx.product.update({
      where: { id: product.id },
      data: { stock: next },
    });
    return;
  }

  let remaining = quantity;
  const fresh = await tx.productVariant.findMany({
    where: { productId: product.id },
    orderBy: { sortOrder: 'asc' },
  });
  for (const v of fresh) {
    if (remaining <= 0) break;
    const take = Math.min(v.stock, remaining);
    if (take > 0) {
      await tx.productVariant.update({
        where: { id: v.id },
        data: { stock: v.stock - take },
      });
    }
    remaining -= take;
  }
  if (remaining > 0) {
    throw new AppError(400, `Insufficient stock for "${product.name}"`);
  }
  await syncParentStockFromVariants(tx, product.id);
}

function flattenProductToSkuLines(p) {
  const category = p.category
    ? { id: p.category.publicId, name: p.category.name, slug: p.category.slug }
    : null;

  const variants = p.variants ?? [];
  if (variants.length > 0) {
    return variants.map((v) => {
      const totalStock = v.stock;
      const stockStatus = stockStatusFromTotal(totalStock);
      return {
        lineKey: `${p.publicId}:${v.publicId}`,
        productId: p.publicId,
        variantId: v.publicId,
        name: p.name,
        variantLabel: combinationLabel(v.combination),
        sku: v.sku,
        category,
        productType: p.productType,
        inventoryModel: p.inventoryModel,
        totalStock,
        stockStatus,
        updatedAt: v.updatedAt,
      };
    });
  }

  const totalStock = p.stock;
  const stockStatus = stockStatusFromTotal(totalStock);
  return [
    {
      lineKey: `${p.publicId}:simple`,
      productId: p.publicId,
      variantId: null,
      name: p.name,
      variantLabel: '—',
      sku: p.sku,
      category,
      productType: p.productType,
      inventoryModel: p.inventoryModel,
      totalStock,
      stockStatus,
      updatedAt: p.updatedAt,
    },
  ];
}

export class InventoryService {
  async getStats() {
    const products = await prisma.product.findMany({
      where: { isDraft: false },
      include: { variants: { orderBy: { sortOrder: 'asc' } } },
    });
    let totalSkus = 0;
    let critical = 0;
    let outOfStock = 0;
    for (const p of products) {
      const lines = flattenProductToSkuLines(p);
      for (const line of lines) {
        totalSkus += 1;
        const t = line.totalStock;
        if (t <= 0) outOfStock += 1;
        else if (t <= LOW_STOCK_THRESHOLD) critical += 1;
      }
    }
    return {
      totalSkus,
      criticalUnderThreshold: critical,
      outOfStock,
      lowStockThreshold: LOW_STOCK_THRESHOLD,
    };
  }

  async list({
    page = 1,
    limit = 24,
    search,
    stockStatus: stockStatusFilter,
    productType: productTypeFilter,
  }) {
    const skip = (page - 1) * limit;

    const where = {
      isDraft: false,
    };

    if (productTypeFilter && productTypeFilter !== 'all') {
      where.productType = productTypeFilter;
    }

    if (search && String(search).trim()) {
      const q = String(search).trim();
      where.AND = where.AND ?? [];
      where.AND.push({
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { sku: { contains: q, mode: 'insensitive' } },
          { variants: { some: { sku: { contains: q, mode: 'insensitive' } } } },
        ],
      });
    }

    const rows = await prisma.product.findMany({
      where,
      include: {
        category: true,
        variants: { orderBy: { sortOrder: 'asc' } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const flat = rows.flatMap((p) => flattenProductToSkuLines(p));

    const filtered = flat.filter((line) => {
      if (!stockStatusFilter || stockStatusFilter === 'all') return true;
      return line.stockStatus === stockStatusFilter;
    });

    const total = filtered.length;
    const slice = filtered.slice(skip, skip + limit);

    return {
      items: slice,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async adjustStock({ productPublicId, variantPublicId, delta, reason, userPublicId }) {
    if (!Number.isInteger(delta) || delta === 0) {
      throw new AppError(400, 'delta must be a non-zero integer');
    }

    const user = await prisma.user.findUnique({
      where: { publicId: userPublicId },
      select: { id: true },
    });
    if (!user) {
      throw new AppError(401, 'User not found');
    }

    return prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { publicId: productPublicId },
        include: { variants: { orderBy: { sortOrder: 'asc' } } },
      });

      if (!product || product.isDraft) {
        throw new AppError(404, 'Product not found');
      }

      const beforeTotal = computeTotalStock(product);

      const { applied } = await adjustManualStock(tx, product, user.id, {
        variantPublicId,
        delta,
        reason,
      });

      const updated = await tx.product.findUnique({
        where: { id: product.id },
        include: { category: true, variants: { orderBy: { sortOrder: 'asc' } } },
      });

      return {
        product: updated,
        quantityChange: applied,
        previousTotal: beforeTotal,
        newTotal: computeTotalStock(updated),
      };
    });
  }

  async updateProductType(productPublicId, productType) {
    const product = await prisma.product.findUnique({ where: { publicId: productPublicId } });
    if (!product) {
      throw new AppError(404, 'Product not found');
    }
    return prisma.product.update({
      where: { id: product.id },
      data: { productType },
      include: { category: true, variants: true },
    });
  }

  async listHistory({ page = 1, limit = 20 }) {
    const skip = (page - 1) * limit;

    const [rows, total] = await Promise.all([
      prisma.inventoryAdjustment.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          product: { select: { publicId: true, name: true, sku: true } },
          productVariant: { select: { publicId: true, sku: true, combination: true } },
          user: {
            select: {
              publicId: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      }),
      prisma.inventoryAdjustment.count(),
    ]);

    const entries = rows.map((r) => ({
      id: r.publicId,
      quantityChange: r.quantityChange,
      reason: r.reason,
      createdAt: r.createdAt,
      product: {
        id: r.product.publicId,
        name: r.product.name,
        sku: r.product.sku,
      },
      variant: r.productVariant
        ? {
            id: r.productVariant.publicId,
            sku: r.productVariant.sku,
            combinationLabel: combinationLabel(r.productVariant.combination),
          }
        : null,
      user: {
        id: r.user.publicId,
        email: r.user.email,
        firstName: r.user.firstName,
        lastName: r.user.lastName,
      },
    }));

    return {
      entries,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit) || 1,
      },
    };
  }
}

/**
 * Validates aggregate stock and decreases inventory for an order line (transaction context).
 */
export async function assertAndDecrementOrderStock(tx, product, quantity) {
  if (quantity < 1) return;
  if (product.isDraft || !product.isActiveListing) {
    throw new AppError(400, `Product "${product.name}" is not available for purchase`);
  }
  const total = computeTotalStock(product);
  if (total < quantity) {
    throw new AppError(400, `Insufficient stock for "${product.name}"`);
  }
  await decrementOrderStockFromProduct(tx, product, quantity);
}

export const inventoryService = new InventoryService();
