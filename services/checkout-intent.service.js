import { refreshPrismaClientIfNeeded } from '../lib/prisma.js';
import { AppError } from '../utils/error-handler.js';

function db() {
  return refreshPrismaClientIfNeeded();
}
import { config } from '../config/env.js';
import { assertStockAvailable } from './inventory.service.js';
import {
  commitOrderLineStock,
  releaseOrderLineStock,
  reserveOrderLineStock,
  variantAvailableStock,
} from './inventory-reservation.js';
import { walletService } from './wallet.service.js';
import { shippingService } from './shipping.service.js';
import {
  computeAppliedUnitPrice,
  resolveSelectedRate,
  selectedRateUpdateData,
} from './order.service.js';
import { assignOrderNumber, placeholderOrderNumber } from '../utils/order-number.js';
import {
  buildCheckoutSignature,
  buildCheckoutSignatureFromOrder,
} from '../utils/checkout-signature.js';

const intentInclude = {
  lines: {
    include: {
      product: true,
      productVariant: true,
    },
  },
};

function checkoutSignature(items, opts = {}) {
  return buildCheckoutSignature({
    items,
    selectedRateId: opts.selectedRateId,
    storeCreditToApply: opts.storeCreditToApply,
    shippingAddress: opts.shippingAddress,
  });
}

function signatureFromIntent(intent) {
  return buildCheckoutSignatureFromOrder(intent, intent.lines);
}

export class CheckoutIntentService {
  async findReusableIntent(userId, signature) {
    const since = new Date(Date.now() - config.pendingOrderTtlMinutes * 60 * 1000);
    const candidates = await db().checkoutIntent.findMany({
      where: {
        userId,
        status: 'PENDING',
        createdAt: { gte: since },
      },
      include: intentInclude,
      orderBy: { createdAt: 'desc' },
      take: 15,
    });

    for (const intent of candidates) {
      if (signatureFromIntent(intent) === signature) {
        return intent;
      }
    }
    return null;
  }

  async supersedeOtherIntents(userId, keepPublicId) {
    const since = new Date(Date.now() - config.pendingOrderTtlMinutes * 60 * 1000);
    const stale = await db().checkoutIntent.findMany({
      where: {
        userId,
        status: 'PENDING',
        publicId: { not: keepPublicId },
        createdAt: { gte: since },
      },
      select: { publicId: true },
    });

    for (const row of stale) {
      await this.releaseIntentResources(row.publicId).catch((err) => {
        console.error('[checkout-intent] supersede release failed', row.publicId, err);
      });
      await db().checkoutIntent.updateMany({
        where: { publicId: row.publicId, status: 'PENDING' },
        data: { status: 'FAILED' },
      });
    }
  }

  async releaseIntentResources(intentPublicId) {
    await db().$transaction(async (tx) => {
      const intent = await tx.checkoutIntent.findUnique({
        where: { publicId: intentPublicId },
        include: { lines: true },
      });
      if (!intent || intent.status === 'CONSUMED') return;

      for (const line of intent.lines) {
        const product = await tx.product.findUnique({
          where: { id: line.productId },
          include: { variants: { orderBy: { sortOrder: 'asc' } } },
        });
        if (!product) continue;
        await releaseOrderLineStock(tx, product, line.productVariantId, line.quantity, {
          referenceType: 'checkout_intent',
          referenceId: intentPublicId,
        });
      }

      if (intent.storeCreditApplied > 0) {
        await walletService.releaseHoldInTx(
          tx,
          intent.userId,
          intent.storeCreditApplied,
          intentPublicId
        );
      }
    });
  }

  async resolveCheckoutIntent(userPublicId, items, opts = {}) {
    const user = await db().user.findUnique({
      where: { publicId: userPublicId },
      select: { id: true },
    });
    if (!user) {
      throw new AppError(401, 'Unauthorized');
    }

    const signature = checkoutSignature(items, opts);

    if (opts.checkoutIntentPublicId) {
      const byId = await db().checkoutIntent.findFirst({
        where: {
          publicId: opts.checkoutIntentPublicId,
          userId: user.id,
          status: 'PENDING',
        },
        include: intentInclude,
      });
      if (byId && signatureFromIntent(byId) === signature) {
        await this.supersedeOtherIntents(user.id, byId.publicId);
        return byId;
      }
    }

    const reusable = await this.findReusableIntent(user.id, signature);
    if (reusable) {
      await this.supersedeOtherIntents(user.id, reusable.publicId);
      return reusable;
    }

    const intent = await this.createCheckoutIntent(userPublicId, items, opts);
    await this.supersedeOtherIntents(user.id, intent.publicId);
    return intent;
  }

  async createCheckoutIntent(userPublicId, items, opts = {}) {
    const user = await db().user.findUnique({
      where: { publicId: userPublicId },
      select: { id: true, accessMemberUntil: true },
    });
    if (!user) {
      throw new AppError(401, 'Unauthorized');
    }

    const now = new Date();
    const hasAccess = Boolean(user.accessMemberUntil && user.accessMemberUntil > now);
    const signature = checkoutSignature(items, opts);
    const expiresAt = new Date(Date.now() + config.pendingOrderTtlMinutes * 60 * 1000);

    let subtotal = 0;
    const lineCreates = [];

    const intent = await db().$transaction(async (tx) => {
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        const product = await tx.product.findUnique({
          where: { publicId: item.productId },
          include: { variants: { orderBy: { sortOrder: 'asc' } } },
        });
        if (!product) {
          throw new AppError(404, `Product not found for item ${index + 1}`);
        }
        if (product.isDraft || !product.isActiveListing) {
          throw new AppError(400, `Product "${product.name}" is not available`);
        }

        let variantDbId = null;
        let variant = null;

        if ((product.variants ?? []).length > 0) {
          if (!item.variantId) {
            throw new AppError(
              400,
              `Select a variant for "${product.name}"`,
              'VARIANT_REQUIRED'
            );
          }
        }

        if (item.variantId) {
          const v = product.variants.find((x) => x.publicId === item.variantId);
          if (!v) {
            throw new AppError(404, `Variant not found for item ${index + 1}`);
          }
          if (variantAvailableStock(v) < item.quantity) {
            throw new AppError(400, `Insufficient stock for "${product.name}"`);
          }
          variant = v;
          variantDbId = v.id;
        } else {
          assertStockAvailable(product, item.quantity);
        }

        const { unitApplied } = computeAppliedUnitPrice(product, variant, hasAccess);
        subtotal += unitApplied * item.quantity;
        lineCreates.push({
          productId: product.id,
          productVariantId: variantDbId,
          quantity: item.quantity,
          price: unitApplied,
        });

        await reserveOrderLineStock(tx, product, variantDbId, item.quantity, {
          referenceType: 'checkout_intent',
          referenceId: signature,
        });
      }

      return tx.checkoutIntent.create({
        data: {
          userId: user.id,
          checkoutSignature: signature,
          status: 'PENDING',
          subtotal,
          shippingCost: 0,
          totalAmount: subtotal,
          storeCreditApplied: 0,
          shippingAddressJson: opts.shippingAddress ?? null,
          billingAddressJson: opts.billingAddress ?? null,
          expiresAt,
          lines: { create: lineCreates },
        },
        include: intentInclude,
      });
    });

    let shippingCost = 0;
    let selectedRate = null;
    let shipmentId = null;
    try {
      const shippingRates = await shippingService.getRates({
        shippingAddress: opts.shippingAddress,
        parcels: opts.parcels,
        preferProviderOnly: false,
        surface: 'checkout',
        hasAccess,
      });
      selectedRate = resolveSelectedRate(shippingRates.rates, opts.selectedRateId, opts.selectedRate);
      shippingCost = Number(selectedRate?.amount || 0);
      shipmentId = shippingRates.shipmentId || null;
    } catch (error) {
      console.error('[checkout-intent] shipping rates failed', intent.publicId, error?.message || error);
      await this.releaseIntentResources(intent.publicId).catch((releaseErr) => {
        console.error('[checkout-intent] release after shipping error failed', releaseErr);
      });
      await db().checkoutIntent.update({
        where: { id: intent.id },
        data: { status: 'FAILED' },
      });
      if (!(error instanceof AppError)) {
        throw new AppError(502, 'Unable to calculate shipping for checkout', 'SHIPPING_RATE_FAILED');
      }
      throw error;
    }

    let totalAmount = subtotal + shippingCost;
    await db().checkoutIntent.update({
      where: { id: intent.id },
      data: {
        shippingCost,
        totalAmount,
        shippingCarrier: selectedRate?.provider || null,
        ...selectedRateUpdateData(selectedRate, shipmentId),
      },
    });
    intent.shippingCost = shippingCost;
    intent.totalAmount = totalAmount;

    if (opts.storeCreditToApply && Number(opts.storeCreditToApply) > 0) {
      try {
        const held = await walletService.holdCredit(
          user.id,
          opts.storeCreditToApply,
          intent.publicId
        );
        if (held > 0) {
          totalAmount = Math.max(0, totalAmount - held);
          await db().checkoutIntent.update({
            where: { id: intent.id },
            data: { totalAmount, storeCreditApplied: held },
          });
          intent.totalAmount = totalAmount;
          intent.storeCreditApplied = held;
        }
      } catch (error) {
        await this.releaseIntentResources(intent.publicId).catch((releaseErr) => {
          console.error('[checkout-intent] release after credit hold error', releaseErr);
        });
        await db().checkoutIntent.update({
          where: { id: intent.id },
          data: { status: 'FAILED' },
        });
        throw error;
      }
    }

    return db().checkoutIntent.findUnique({
      where: { id: intent.id },
      include: intentInclude,
    });
  }

  /** Create a paid Order from a consumed checkout intent (idempotent). */
  async createPaidOrderFromCheckoutIntent(checkoutIntentPublicId) {
    const existing = await db().checkoutIntent.findUnique({
      where: { publicId: checkoutIntentPublicId },
      include: intentInclude,
    });
    if (!existing) {
      throw new AppError(404, 'Checkout not found');
    }

    if (existing.status === 'CONSUMED' && existing.orderPublicId) {
      return db().order.findUnique({
        where: { publicId: existing.orderPublicId },
        include: { orderItems: { include: { product: true } } },
      });
    }

    if (existing.status !== 'PENDING') {
      throw new AppError(409, 'Checkout is no longer valid', 'CHECKOUT_INTENT_INVALID');
    }

    const order = await db().$transaction(async (tx) => {
      const intent = await tx.checkoutIntent.findUnique({
        where: { publicId: checkoutIntentPublicId },
        include: { lines: true },
      });
      if (!intent || intent.status !== 'PENDING') {
        throw new AppError(409, 'Checkout already processed', 'CHECKOUT_INTENT_INVALID');
      }

      const created = await tx.order.create({
        data: {
          userId: intent.userId,
          orderNumber: placeholderOrderNumber(),
          totalAmount: intent.totalAmount,
          shippingCost: intent.shippingCost,
          storeCreditApplied: intent.storeCreditApplied,
          paymentStatus: 'PAID',
          status: 'PROCESSING',
          fulfillmentStatus: 'NEW_ORDER',
          shippingAddressJson: intent.shippingAddressJson,
          billingAddressJson: intent.billingAddressJson,
          shippingCarrier: intent.shippingCarrier,
          stripePaymentIntentId: intent.stripePaymentIntentId,
          stripeCheckoutSessionId: intent.stripePaymentIntentId,
          shippingShipmentId: intent.shippingShipmentId,
          selectedRateId: intent.selectedRateId,
          selectedRateProvider: intent.selectedRateProvider,
          selectedRateServiceLevel: intent.selectedRateServiceLevel,
          selectedRateServiceToken: intent.selectedRateServiceToken,
          selectedRateAmount: intent.selectedRateAmount,
          selectedRateCurrency: intent.selectedRateCurrency,
          selectedRateEstimatedDays: intent.selectedRateEstimatedDays,
          orderItems: {
            create: intent.lines.map((line) => ({
              productId: line.productId,
              productVariantId: line.productVariantId,
              quantity: line.quantity,
              price: line.price,
            })),
          },
        },
        include: { orderItems: { include: { product: true } } },
      });
      await assignOrderNumber(tx, created.id);

      for (const line of intent.lines) {
        const product = await tx.product.findUnique({
          where: { id: line.productId },
          include: { variants: { orderBy: { sortOrder: 'asc' } } },
        });
        await commitOrderLineStock(tx, product, line.productVariantId, line.quantity, {
          referenceType: 'order',
          referenceId: created.publicId,
        });
      }

      if (intent.storeCreditApplied > 0) {
        await walletService.captureHoldInTx(
          tx,
          intent.userId,
          intent.storeCreditApplied,
          created.publicId
        );
      }

      await tx.checkoutIntent.update({
        where: { id: intent.id },
        data: { status: 'CONSUMED', orderPublicId: created.publicId },
      });

      const fullOrder = await tx.order.findUnique({
        where: { id: created.id },
        include: { orderItems: true },
      });
      const { createUnitsForPaidOrder } = await import('./product-unit.service.js');
      await createUnitsForPaidOrder(tx, fullOrder, fullOrder.orderItems);

      return tx.order.findUnique({
        where: { id: created.id },
        include: { orderItems: { include: { product: true } } },
      });
    });

    return order;
  }

  async expireStaleCheckoutIntents() {
    const ttlMs = config.pendingOrderTtlMinutes * 60 * 1000;
    const cutoff = new Date(Date.now() - ttlMs);
    const stale = await db().checkoutIntent.findMany({
      where: {
        status: 'PENDING',
        createdAt: { lt: cutoff },
      },
      select: { publicId: true },
      take: 50,
      orderBy: { createdAt: 'asc' },
    });

    for (const row of stale) {
      await this.releaseIntentResources(row.publicId).catch((err) => {
        console.error('[checkout-intent] expire release failed', row.publicId, err);
      });
      await db().checkoutIntent.updateMany({
        where: { publicId: row.publicId, status: 'PENDING' },
        data: { status: 'EXPIRED' },
      });
    }

    return stale.length;
  }
}

export const checkoutIntentService = new CheckoutIntentService();
