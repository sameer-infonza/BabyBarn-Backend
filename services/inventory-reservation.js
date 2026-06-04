import { AppError } from '../utils/error-handler.js';
import { syncParentStockFromVariants } from './inventory.service.js';

export function variantAvailableStock(variant) {
  return Math.max(0, variant.stock - (variant.reservedStock ?? 0));
}

export function productAvailableStock(product) {
  const variants = product.variants ?? [];
  if (variants.length > 0) {
    return variants.reduce((sum, v) => sum + variantAvailableStock(v), 0);
  }
  return Math.max(0, product.stock - (product.reservedStock ?? 0));
}

/** Reserve stock when a pending order is created. */
export async function reserveOrderLineStock(tx, product, variantDbId, quantity) {
  if (quantity < 1) return;

  if (variantDbId) {
    const v = await tx.productVariant.findUnique({ where: { id: variantDbId } });
    if (!v) throw new AppError(404, 'Variant not found');
    const available = variantAvailableStock(v);
    if (available < quantity) {
      throw new AppError(400, `Insufficient stock for "${product.name}"`, 'INSUFFICIENT_STOCK');
    }
    const updated = await tx.productVariant.updateMany({
      where: {
        id: variantDbId,
        stockVersion: v.stockVersion,
        stock: { gte: (v.reservedStock ?? 0) + quantity },
      },
      data: {
        reservedStock: { increment: quantity },
        stockVersion: { increment: 1 },
      },
    });
    if (updated.count === 0) {
      throw new AppError(409, 'Stock changed during checkout. Please try again.', 'STOCK_CONFLICT');
    }
    return;
  }

  const fresh = await tx.product.findUnique({
    where: { id: product.id },
    include: { variants: { orderBy: { sortOrder: 'asc' } } },
  });
  const available = productAvailableStock(fresh);
  if (available < quantity) {
    throw new AppError(400, `Insufficient stock for "${product.name}"`, 'INSUFFICIENT_STOCK');
  }

  if ((fresh.variants ?? []).length === 0) {
    const updated = await tx.product.updateMany({
      where: {
        id: product.id,
        stock: { gte: (fresh.reservedStock ?? 0) + quantity },
      },
      data: { reservedStock: { increment: quantity } },
    });
    if (updated.count === 0) {
      throw new AppError(409, 'Stock changed during checkout. Please try again.', 'STOCK_CONFLICT');
    }
    return;
  }

  let remaining = quantity;
  const variants = await tx.productVariant.findMany({
    where: { productId: product.id },
    orderBy: { sortOrder: 'asc' },
  });
  for (const v of variants) {
    if (remaining <= 0) break;
    const take = Math.min(variantAvailableStock(v), remaining);
    if (take <= 0) continue;
    const updated = await tx.productVariant.updateMany({
      where: {
        id: v.id,
        stockVersion: v.stockVersion,
        stock: { gte: (v.reservedStock ?? 0) + take },
      },
      data: {
        reservedStock: { increment: take },
        stockVersion: { increment: 1 },
      },
    });
    if (updated.count === 0) {
      throw new AppError(409, 'Stock changed during checkout. Please try again.', 'STOCK_CONFLICT');
    }
    remaining -= take;
  }
  if (remaining > 0) {
    throw new AppError(400, `Insufficient stock for "${product.name}"`, 'INSUFFICIENT_STOCK');
  }
}

/** Convert reservation to a sale after payment succeeds. */
export async function commitOrderLineStock(tx, product, variantDbId, quantity) {
  if (quantity < 1) return;

  if (variantDbId) {
    const v = await tx.productVariant.findUnique({ where: { id: variantDbId } });
    if (!v || v.reservedStock < quantity || v.stock < quantity) {
      throw new AppError(400, `Insufficient stock for "${product.name}"`, 'INSUFFICIENT_STOCK');
    }
    await tx.productVariant.update({
      where: { id: variantDbId },
      data: {
        stock: { decrement: quantity },
        reservedStock: { decrement: quantity },
        stockVersion: { increment: 1 },
      },
    });
    await syncParentStockFromVariants(tx, product.id);
    return;
  }

  const fresh = await tx.product.findUnique({
    where: { id: product.id },
    include: { variants: { orderBy: { sortOrder: 'asc' } } },
  });

  if ((fresh.variants ?? []).length === 0) {
    if ((fresh.reservedStock ?? 0) < quantity || fresh.stock < quantity) {
      throw new AppError(400, `Insufficient stock for "${product.name}"`, 'INSUFFICIENT_STOCK');
    }
    await tx.product.update({
      where: { id: product.id },
      data: {
        stock: { decrement: quantity },
        reservedStock: { decrement: quantity },
      },
    });
    return;
  }

  let remaining = quantity;
  const variants = await tx.productVariant.findMany({
    where: { productId: product.id },
    orderBy: { sortOrder: 'asc' },
  });
  for (const v of variants) {
    if (remaining <= 0) break;
    const reserved = Math.min(v.reservedStock ?? 0, remaining);
    if (reserved <= 0) continue;
    await tx.productVariant.update({
      where: { id: v.id },
      data: {
        stock: { decrement: reserved },
        reservedStock: { decrement: reserved },
        stockVersion: { increment: 1 },
      },
    });
    remaining -= reserved;
  }
  if (remaining > 0) {
    throw new AppError(400, `Insufficient reserved stock for "${product.name}"`, 'INSUFFICIENT_STOCK');
  }
  await syncParentStockFromVariants(tx, product.id);
}

/** Release reservation when checkout fails or expires. */
export async function releaseOrderLineStock(tx, product, variantDbId, quantity) {
  if (quantity < 1) return;

  if (variantDbId) {
    const v = await tx.productVariant.findUnique({ where: { id: variantDbId } });
    if (!v) return;
    const toRelease = Math.min(v.reservedStock ?? 0, quantity);
    if (toRelease <= 0) return;
    await tx.productVariant.update({
      where: { id: variantDbId },
      data: { reservedStock: { decrement: toRelease } },
    });
    return;
  }

  const fresh = await tx.product.findUnique({
    where: { id: product.id },
    include: { variants: { orderBy: { sortOrder: 'asc' } } },
  });

  if ((fresh.variants ?? []).length === 0) {
    const toRelease = Math.min(fresh.reservedStock ?? 0, quantity);
    if (toRelease <= 0) return;
    await tx.product.update({
      where: { id: product.id },
      data: { reservedStock: { decrement: toRelease } },
    });
    return;
  }

  let remaining = quantity;
  const variants = await tx.productVariant.findMany({
    where: { productId: product.id },
    orderBy: { sortOrder: 'asc' },
  });
  for (const v of variants) {
    if (remaining <= 0) break;
    const toRelease = Math.min(v.reservedStock ?? 0, remaining);
    if (toRelease <= 0) continue;
    await tx.productVariant.update({
      where: { id: v.id },
      data: { reservedStock: { decrement: toRelease } },
    });
    remaining -= toRelease;
  }
}
