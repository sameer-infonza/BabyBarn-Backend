import { prisma } from '../lib/prisma.js';
import { AppError } from '../utils/error-handler.js';
import { writeAdminAudit } from './audit.service.js';
import { lookup, updateLocation } from './barcode.service.js';
import { combinationLabel, inventoryService } from './inventory.service.js';
import { orderService } from './order.service.js';
import { returnsService } from './returns.service.js';
import { restockOrderLineStock } from './inventory-reservation.js';

const ADD_REASONS = new Set([
  'New Inventory',
  'Inventory Correction',
  'Manual Stock Addition',
  'Shipment received',
  'Inventory mismatch',
  'Other',
]);

function actorFrom(actor) {
  return { id: actor?.id ?? null, email: actor?.email ?? null };
}

function qtyFromMode(mode, quantity) {
  if (mode === 'each') return 1;
  const n = Number(quantity);
  if (!Number.isInteger(n) || n < 1) {
    throw new AppError(400, 'Enter a quantity of 1 or more');
  }
  return n;
}

function reasonOrThrow(reason) {
  const r = String(reason || '').trim();
  if (r.length < 3) throw new AppError(400, 'Reason is required (at least 3 characters)');
  return ADD_REASONS.has(r) || r.length >= 3 ? r : r;
}

export async function resolveScan(code) {
  return lookup(code, { ensureIfSku: false });
}

async function adjustFromHit(hit, delta, reason, actor) {
  return inventoryService.adjustStock({
    productPublicId: hit.product.id,
    variantPublicId: hit.variant?.id ?? undefined,
    delta,
    reason,
    userPublicId: actor?.id,
  });
}

export async function receiveOrAdd({ code, mode, quantity, reason, location, actor, kind }) {
  const hit = await lookup(code);
  const qty = qtyFromMode(mode, quantity);
  const note = reasonOrThrow(reason || (kind === 'receive' ? 'Shipment received' : ''));
  if (location != null && String(location).trim()) {
    await updateLocation(hit.code, location, actor);
  }
  const result = await adjustFromHit(hit, qty, note, actor);
  await writeAdminAudit({
    ...actorFrom(actor),
    action: kind === 'receive' ? 'SCAN_RECEIVE' : 'SCAN_ADD',
    entityType: 'ProductBarcode',
    entityId: hit.code,
    meta: { qty, reason: note, mode: mode || 'bulk' },
  });
  return { product: await lookup(hit.code), adjustment: result };
}

export async function verifyCount({ code, counted, applyAdjustment, actor }) {
  const hit = await lookup(code);
  const countedQty = Number(counted);
  if (!Number.isInteger(countedQty) || countedQty < 0) {
    throw new AppError(400, 'Counted quantity must be a whole number');
  }
  const mismatch = countedQty !== hit.onHand;
  let adjustment = null;
  if (mismatch && applyAdjustment) {
    const delta = countedQty - hit.onHand;
    if (delta !== 0) {
      adjustment = await adjustFromHit(hit, delta, 'Inventory mismatch', actor);
    }
  } else if (mismatch) {
    await writeAdminAudit({
      ...actorFrom(actor),
      action: 'SCAN_VERIFY_MISMATCH',
      entityType: 'ProductBarcode',
      entityId: hit.code,
      meta: { onHand: hit.onHand, counted: countedQty },
    });
  }
  return {
    product: await lookup(hit.code),
    mismatch,
    counted: countedQty,
    onHand: hit.onHand,
    adjusted: Boolean(adjustment),
  };
}

async function findOrder(orderRef) {
  const q = String(orderRef || '').trim();
  if (!q) throw new AppError(400, 'Order number is required');
  const order = await prisma.order.findFirst({
    where: { OR: [{ publicId: q }, { orderNumber: { equals: q, mode: 'insensitive' } }] },
    include: {
      orderItems: {
        include: {
          product: { select: { publicId: true, name: true, sku: true } },
          productVariant: { select: { publicId: true, sku: true, combination: true } },
        },
      },
      user: { select: { firstName: true, lastName: true, email: true } },
    },
  });
  if (!order) throw new AppError(404, 'Order not found');
  return order;
}

function matchingLine(order, hit) {
  return order.orderItems.find((li) => {
    if (li.cancelledAt) return false;
    if (li.product?.publicId !== hit.product.id) return false;
    const lineVariant = li.productVariant?.publicId || null;
    const hitVariant = hit.variant?.id || null;
    if (lineVariant || hitVariant) {
      return Boolean(lineVariant && hitVariant && lineVariant === hitVariant);
    }
    return true;
  });
}

export async function pickByScan({ code, orderRef, mode, quantity, actor }) {
  const hit = await lookup(code);
  const order = await findOrder(orderRef);
  if (order.paymentStatus !== 'PAID') {
    throw new AppError(400, 'Only paid orders can be picked');
  }
  const line = matchingLine(order, hit);
  if (!line) {
    throw new AppError(400, 'Scanned barcode does not match a product on this order', 'SKU_MISMATCH');
  }
  const add = qtyFromMode(mode, quantity);
  const remaining = Math.max(0, line.quantity - (line.pickedQuantity || 0));
  if (remaining <= 0) throw new AppError(400, 'This line is already fully picked');
  const next = Math.min(line.quantity, (line.pickedQuantity || 0) + add);
  const updated = await orderService.pickOrderItem(order.publicId, line.publicId, { pickedQuantity: next }, actor);
  return {
    product: hit,
    orderId: updated.publicId,
    orderNumber: updated.orderNumber,
    pickedQuantity: next,
    requiredQuantity: line.quantity,
    fulfillmentStatus: updated.fulfillmentStatus,
    allPicked: updated.orderItems.every((li) => (li.pickedQuantity || 0) >= li.quantity),
  };
}

export async function cancelRestoreByScan({ code, orderRef, actor }) {
  const hit = await lookup(code);
  const order = await findOrder(orderRef);
  const line = matchingLine(order, hit);
  if (!line) {
    throw new AppError(400, 'Scanned barcode does not match a product on this order', 'SKU_MISMATCH');
  }
  const cancellable = order.status === 'CANCELLED' || order.status === 'REFUNDED' || line.cancelledAt;
  if (!cancellable) {
    throw new AppError(400, 'This order is not cancelled');
  }

  const already = await prisma.inventoryLedgerEvent.findFirst({
    where: {
      referenceType: 'order',
      referenceId: order.publicId,
      eventType: { in: ['RELEASE', 'REFUND_RESTORE'] },
      product: { publicId: hit.product.id },
    },
    select: { id: true },
  });
  if (already) {
    return { product: hit, alreadyRestored: true, stockChanged: false };
  }

  if (order.paymentStatus === 'PAID' && order.status === 'CANCELLED') {
    const product = await prisma.product.findUnique({
      where: { publicId: hit.product.id },
      include: { variants: true },
    });
    const variantDbId = hit.variant
      ? (await prisma.productVariant.findUnique({ where: { publicId: hit.variant.id }, select: { id: true } }))?.id
      : null;
    await prisma.$transaction(async (tx) => {
      await restockOrderLineStock(
        tx,
        product,
        variantDbId,
        line.quantity,
        {
          referenceType: 'order',
          referenceId: order.publicId,
          actorUserId: null,
          note: 'Warehouse scan restore after cancellation',
        },
        'REFUND_RESTORE'
      );
    });
    await writeAdminAudit({
      ...actorFrom(actor),
      action: 'SCAN_CANCEL_RESTORE',
      entityType: 'Order',
      entityId: order.publicId,
      meta: { code: hit.code, qty: line.quantity },
    });
    return { product: await lookup(hit.code), alreadyRestored: false, stockChanged: true };
  }

  return { product: hit, alreadyRestored: true, stockChanged: false };
}

export async function returnRestockByScan({ code, returnRef, quantity, actor }) {
  const hit = await lookup(code);
  const q = String(returnRef || '').trim();
  const rr = await prisma.returnRequest.findFirst({
    where: {
      OR: [{ publicId: q }, { submissionPublicId: q }, { returnNumber: { equals: q, mode: 'insensitive' } }],
    },
    include: { orderItem: { include: { product: { select: { publicId: true } } } } },
    orderBy: { createdAt: 'asc' },
  });
  if (!rr) throw new AppError(404, 'Return not found');
  if (rr.type !== 'STANDARD') throw new AppError(400, 'Use the refurbishment action for this return');

  const siblings = await prisma.returnRequest.findMany({
    where: { submissionPublicId: rr.submissionPublicId },
    include: { orderItem: { include: { product: { select: { publicId: true } } } } },
  });
  const match = siblings.find((s) => s.orderItem?.product?.publicId === hit.product.id);
  if (!match) {
    throw new AppError(400, 'Scanned barcode does not match this return', 'SKU_MISMATCH');
  }
  const qty = quantity != null ? Number(quantity) : undefined;
  const updated = await returnsService.restockReturn(
    rr.publicId,
    { items: [{ returnItemId: match.publicId, quantity: qty }] },
    actor
  );
  return { product: await lookup(hit.code), return: updated };
}

export async function refurbMoveByScan({ code, returnRef, quantity, actor }) {
  const hit = await lookup(code);
  const q = String(returnRef || '').trim();
  const rr = await prisma.returnRequest.findFirst({
    where: {
      OR: [{ publicId: q }, { submissionPublicId: q }, { returnNumber: { equals: q, mode: 'insensitive' } }],
    },
    include: {
      orderItem: { include: { product: { select: { id: true, publicId: true } } } },
    },
  });
  if (!rr) throw new AppError(404, 'Return not found');
  if (rr.orderItem?.product?.publicId !== hit.product.id) {
    throw new AppError(400, 'Scanned barcode does not match this return', 'SKU_MISMATCH');
  }
  const qty = qtyFromMode('bulk', quantity ?? 1);
  const listed = await prisma.product.findFirst({
    where: {
      productType: 'REFURBISHED',
      OR: [{ sourceReturnId: rr.id }, { sourceProductId: rr.orderItem.productId }],
    },
    include: { variants: { take: 1, orderBy: { sortOrder: 'asc' } } },
  });
  if (!listed) {
    throw new AppError(400, 'List the refurbished SKU before moving inventory here');
  }
  await prisma.$transaction(async (tx) => {
    await restockOrderLineStock(
      tx,
      listed,
      listed.variants[0]?.id ?? null,
      qty,
      {
        referenceType: 'refurbishment_job',
        referenceId: rr.publicId,
        note: 'Warehouse scan move to refurbishment inventory',
      },
      'RESTOCK'
    );
    await tx.returnRequest.update({
      where: { id: rr.id },
      data: { disposition: 'REFURB', restockedAt: new Date(), restockedQuantity: qty },
    });
  });
  await writeAdminAudit({
    ...actorFrom(actor),
    action: 'SCAN_REFURB_MOVE',
    entityType: 'ReturnRequest',
    entityId: rr.publicId,
    meta: { code: hit.code, qty, refurbishedProductId: listed.publicId },
  });
  return { product: hit, refurbishedProductId: listed.publicId, quantity: qty };
}

function barcodeForLine(barcodes, line) {
  const productId = line.product?.publicId;
  const variantId = line.productVariant?.publicId || null;
  return (
    barcodes.find((b) => {
      if (b.product?.publicId !== productId) return false;
      const bVariant = b.variant?.publicId || null;
      if (variantId || bVariant) return Boolean(variantId && bVariant && variantId === bVariant);
      return !bVariant;
    })?.code ?? null
  );
}

export async function getOrderPickChecklist(orderRef) {
  const order = await findOrder(orderRef);
  if (order.paymentStatus !== 'PAID') {
    throw new AppError(400, 'Only paid orders can be picked');
  }
  const activeLines = order.orderItems.filter((li) => !li.cancelledAt);
  const productPublicIds = [...new Set(activeLines.map((li) => li.product.publicId))];
  const barcodes =
    productPublicIds.length === 0
      ? []
      : await prisma.productBarcode.findMany({
          where: { product: { publicId: { in: productPublicIds } } },
          include: {
            product: { select: { publicId: true } },
            variant: { select: { publicId: true } },
          },
        });

  const lines = activeLines.map((li) => ({
    id: li.publicId,
    productId: li.product.publicId,
    variantId: li.productVariant?.publicId ?? null,
    name: li.product.name,
    sku: li.product.sku,
    variantLabel: li.productVariant ? combinationLabel(li.productVariant.combination) : null,
    quantity: li.quantity,
    pickedQuantity: li.pickedQuantity || 0,
    barcodeCode: barcodeForLine(barcodes, li),
  }));

  return {
    orderId: order.publicId,
    orderNumber: order.orderNumber,
    paymentStatus: order.paymentStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    allPicked: lines.every((li) => li.pickedQuantity >= li.quantity),
    lines,
  };
}

export const inventoryScanService = {
  resolveScan,
  receiveOrAdd,
  verifyCount,
  pickByScan,
  cancelRestoreByScan,
  returnRestockByScan,
  refurbMoveByScan,
  getOrderPickChecklist,
};
