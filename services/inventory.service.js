import { prisma } from '../lib/prisma.js';
import { AppError } from '../utils/error-handler.js';
import { productAvailableStock, variantAvailableStock } from './inventory-reservation.js';
import { writeInventoryLedger } from './inventory-ledger.service.js';
import {
  DEFAULT_LOW_STOCK_THRESHOLD,
  assertSellableStock,
  lowStockThresholdFromPar,
  stockStatusFromAvailable,
} from '../lib/inventory-stock-rules.js';
import { notifyLowStock } from './admin-notification.service.js';

export const LOW_STOCK_THRESHOLD = DEFAULT_LOW_STOCK_THRESHOLD;

export function computeTotalStock(product) {
  const variants = product.variants ?? [];
  if (variants.length > 0) {
    return variants.reduce((s, v) => s + v.stock, 0);
  }
  return product.stock;
}

export function computeAvailableStock(product) {
  return productAvailableStock(product);
}

/** Validates aggregate available stock without mutating (for unpaid checkout orders). */
export function assertStockAvailable(product, quantity) {
  assertSellableStock(product, quantity);
}

export function stockStatusFromTotal(total, reorderPoint, productType = 'NEW') {
  return stockStatusFromAvailable(total, reorderPoint, productType);
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
    await writeInventoryLedger(tx, {
      productId: product.id,
      productVariantId: null,
      quantityDelta: applied,
      eventType: 'ADJUST',
      referenceType: 'inventory_adjustment',
      referenceId: product.publicId,
      actorUserId: userId,
      note: reason?.trim() || null,
    });
    return { applied, variantPublicId: null, variantDbId: null };
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
  await writeInventoryLedger(tx, {
    productId: product.id,
    productVariantId: v.id,
    quantityDelta: applied,
    eventType: 'ADJUST',
    referenceType: 'inventory_adjustment',
    referenceId: `${product.publicId}:${v.publicId}`,
    actorUserId: userId,
    note: reason?.trim() || null,
  });

  return { applied, variantPublicId: v.publicId, variantDbId: v.id };
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
      const reservedStock = v.reservedStock ?? 0;
      const availableStock = variantAvailableStock(v);
      const stockStatus = stockStatusFromAvailable(availableStock, p.reorderPoint, p.productType);
      return {
        lineKey: `${p.publicId}:${v.publicId}`,
        productId: p.publicId,
        variantId: v.publicId,
        name: p.name,
        variantLabel: combinationLabel(v.combination),
        sku: v.sku,
        category,
        productType: p.productType,
        reorderPoint: p.reorderPoint ?? null,
        lowStockThreshold: lowStockThresholdFromPar(p.reorderPoint),
        sourceProduct: p.sourceProduct
          ? { id: p.sourceProduct.publicId, name: p.sourceProduct.name, sku: p.sourceProduct.sku }
          : null,
        inventoryModel: p.inventoryModel,
        totalStock,
        reservedStock,
        availableStock,
        stockStatus,
        updatedAt: v.updatedAt,
      };
    });
  }

  const totalStock = p.stock;
  const reservedStock = p.reservedStock ?? 0;
  const availableStock = productAvailableStock(p);
  const stockStatus = stockStatusFromAvailable(availableStock, p.reorderPoint, p.productType);
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
      reorderPoint: p.reorderPoint ?? null,
      lowStockThreshold: lowStockThresholdFromPar(p.reorderPoint),
      sourceProduct: p.sourceProduct
        ? { id: p.sourceProduct.publicId, name: p.sourceProduct.name, sku: p.sourceProduct.sku }
        : null,
      inventoryModel: p.inventoryModel,
      totalStock,
      reservedStock,
      availableStock,
      stockStatus,
      updatedAt: p.updatedAt,
    },
  ];
}

function productTypeWhere(productType) {
  if (productType === 'NEW' || productType === 'REFURBISHED') {
    return { productType };
  }
  return { productType: 'NEW' };
}

export class InventoryService {
  async getStats({ productType } = {}) {
    const products = await prisma.product.findMany({
      where: { isDraft: false, ...productTypeWhere(productType) },
      include: { variants: { orderBy: { sortOrder: 'asc' } } },
    });
    let totalSkus = 0;
    let critical = 0;
    let outOfStock = 0;
    for (const p of products) {
      const lines = flattenProductToSkuLines(p);
      for (const line of lines) {
        totalSkus += 1;
        const t = line.availableStock ?? line.totalStock;
        if (t <= 0 || line.stockStatus === 'out_of_stock') outOfStock += 1;
        else if (line.stockStatus === 'low_stock') critical += 1;
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
      ...productTypeWhere(
        productTypeFilter && productTypeFilter !== 'all' ? productTypeFilter : undefined
      ),
    };

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
        sourceProduct: { select: { publicId: true, name: true, sku: true } },
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

    const result = await prisma.$transaction(async (tx) => {
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

    const available = productAvailableStock(result.product);
    const status = stockStatusFromAvailable(
      available,
      result.product.reorderPoint,
      result.product.productType
    );
    if (status === 'low_stock') {
      notifyLowStock(result.product, available);
    }

    return result;
  }

  async updateProductType(productPublicId, productType) {
    const { isRefurbishedEnabled } = await import('../config/feature-flags.js');
    if (productType === 'REFURBISHED' && !isRefurbishedEnabled()) {
      throw new AppError(400, 'Refurbished products are temporarily disabled', 'REFURBISHED_DISABLED');
    }
    const product = await prisma.product.findUnique({ where: { publicId: productPublicId } });
    if (!product) {
      throw new AppError(404, 'Product not found');
    }
    if (product.sourceProductId != null || product.productType === 'REFURBISHED') {
      throw new AppError(
        400,
        'Cannot change product type on a pipeline refurb SKU.',
        'REFURB_LOCKED'
      );
    }
    return prisma.product.update({
      where: { id: product.id },
      data: { productType },
      include: { category: true, variants: true },
    });
  }

  async listHistory({
    page = 1,
    limit = 20,
    productPublicId = null,
    productType = null,
    search = null,
  }) {
    const { listLedgerHistory } = await import('./inventory-ledger.service.js');
    const ledger = await listLedgerHistory({
      page,
      limit,
      productPublicId,
      productType,
      search,
    });
    return {
      entries: ledger.entries.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        quantityChange: e.quantityDelta,
        reason: e.note,
        referenceType: e.referenceType,
        referenceId: e.referenceId,
        referenceOrderNumber: e.referenceOrderNumber ?? null,
        referenceCheckoutIntentId: e.referenceCheckoutIntentId ?? null,
        referenceReturnNumber: e.referenceReturnNumber ?? null,
        referenceReturnType: e.referenceReturnType ?? null,
        createdAt: e.createdAt,
        product: e.product,
        variant: e.variant,
        user: e.actor ?? null,
      })),
      pagination: ledger.pagination,
    };
  }

  async getProductTimeline(productPublicId) {
    const product = await prisma.product.findUnique({
      where: { publicId: productPublicId },
      select: { id: true, publicId: true, name: true },
    });
    if (!product) throw new AppError(404, 'Product not found');

    const { listLedgerHistory } = await import('./inventory-ledger.service.js');

    const [ledgerResult, units, orderLines] = await Promise.all([
      listLedgerHistory({ productPublicId, page: 1, limit: 100 }),
      prisma.productUnit.findMany({
        where: { productId: product.id },
        orderBy: { updatedAt: 'desc' },
        take: 50,
        include: { events: { orderBy: { createdAt: 'desc' }, take: 20 } },
      }),
      prisma.orderItem.findMany({
        where: { productId: product.id },
        orderBy: { createdAt: 'desc' },
        take: 30,
        include: {
          order: { select: { publicId: true, orderNumber: true, status: true, paymentStatus: true, createdAt: true } },
        },
      }),
    ]);

    return {
      product: { id: product.publicId, name: product.name },
      ledger: ledgerResult.entries.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        quantityDelta: e.quantityDelta,
        referenceType: e.referenceType,
        referenceId: e.referenceId,
        referenceOrderNumber: e.referenceOrderNumber ?? null,
        referenceCheckoutIntentId: e.referenceCheckoutIntentId ?? null,
        referenceReturnNumber: e.referenceReturnNumber ?? null,
        referenceReturnType: e.referenceReturnType ?? null,
        note: e.note ?? null,
        createdAt: e.createdAt,
        variantSku: e.variant?.sku ?? null,
      })),
      units: units.map((u) => ({
        id: u.publicId,
        unitSku: u.unitSku,
        status: u.status,
        cycleNumber: u.cycleNumber,
        purchasedAt: u.purchasedAt,
        returnedAt: u.returnedAt,
        relistedAt: u.relistedAt,
        events: u.events.map((ev) => ({
          id: ev.publicId,
          fromStatus: ev.fromStatus,
          toStatus: ev.toStatus,
          note: ev.note,
          createdAt: ev.createdAt,
        })),
      })),
      orders: orderLines.map((li) => ({
        orderId: li.order.publicId,
        orderNumber: li.order.orderNumber,
        quantity: li.quantity,
        status: li.order.status,
        paymentStatus: li.order.paymentStatus,
        createdAt: li.order.createdAt,
      })),
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
