import { PrismaClient } from '@prisma/client';
import { AppError } from '../utils/error-handler.js';
import {
  assertAndDecrementOrderStock,
  assertStockAvailable,
  syncParentStockFromVariants,
} from './inventory.service.js';
import { shippingService } from './shipping.service.js';
import { writeAdminAudit } from './audit.service.js';

const prisma = new PrismaClient();

/** Same rules as checkout quote: variant override, then ACCESS memberPrice cap when eligible. */
function computeAppliedUnitPrice(product, variant, hasAccess) {
  let unitRetail = Number(product.price);
  let unitApplied = unitRetail;
  if (variant) {
    const vPrice = variant.priceOverride != null ? Number(variant.priceOverride) : unitRetail;
    unitRetail = vPrice;
    unitApplied = vPrice;
  }
  if (hasAccess && product.memberPrice != null && Number(product.memberPrice) > 0) {
    unitApplied = Math.min(unitApplied, Number(product.memberPrice));
  }
  return { unitRetail, unitApplied };
}

function isMissingWalletTableError(error) {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error.code === 'P2021' || error.code === 'P2022')
  );
}

const userForOrderList = {
  select: {
    id: true,
    publicId: true,
    email: true,
    firstName: true,
    lastName: true,
    accessMemberUntil: true,
    role: { select: { name: true } },
  },
};

function parseDateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function selectedRateUpdateData(selectedRate, shipmentId = null) {
  return {
    shippingShipmentId: shipmentId || null,
    selectedRateId: selectedRate?.rateId || null,
    selectedRateProvider: selectedRate?.provider || null,
    selectedRateServiceLevel: selectedRate?.serviceLevel || null,
    selectedRateServiceToken: selectedRate?.serviceToken || null,
    selectedRateAmount: selectedRate ? Number(selectedRate.amount || 0) : null,
    selectedRateCurrency: selectedRate?.currency || null,
    selectedRateEstimatedDays:
      selectedRate?.estimatedDays == null ? null : Number(selectedRate.estimatedDays || 0),
  };
}

function resolveSelectedRate(rates, requestedRateId, requestedRate = null) {
  const list = Array.isArray(rates) ? rates : [];
  const requested = String(requestedRateId || '').trim();
  if (!requested) return list[0] || null;
  const exact = list.find((rate) => String(rate?.rateId || '') === requested) || null;
  if (exact) return exact;
  const snapshot = requestedRate && typeof requestedRate === 'object' ? requestedRate : null;
  if (snapshot) {
    const provider = String(snapshot.provider || '').trim().toLowerCase();
    const token = String(snapshot.serviceToken || '').trim().toLowerCase();
    const level = String(snapshot.serviceLevel || '').trim().toLowerCase();
    const amount = Number(snapshot.amount);
    const fuzzy = list.find((rate) => {
      const rp = String(rate?.provider || '').trim().toLowerCase();
      const rt = String(rate?.serviceToken || '').trim().toLowerCase();
      const rl = String(rate?.serviceLevel || '').trim().toLowerCase();
      const ra = Number(rate?.amount || 0);
      const providerOk = provider ? rp === provider : true;
      const serviceOk = token ? rt === token : level ? rl === level : true;
      const amountOk = Number.isFinite(amount) ? Math.abs(ra - amount) < 0.011 : true;
      return providerOk && serviceOk && amountOk;
    });
    if (fuzzy) return fuzzy;
  }
  throw new AppError(409, 'Selected shipping rate is stale. Please refresh rates and choose again.', 'SHIPPING_RATE_STALE', {
    selectedRateId: requested,
    availableRateIds: list.map((rate) => String(rate?.rateId || '')).filter(Boolean),
  });
}

export class OrderService {
  async calculateCheckoutQuote(userPublicId, payload) {
    const user = await prisma.user.findUnique({
      where: { publicId: userPublicId },
      select: { id: true, accessMemberUntil: true },
    });
    if (!user) throw new AppError(401, 'Unauthorized');
    const items = Array.isArray(payload?.items) ? payload.items : [];
    if (items.length === 0) throw new AppError(400, 'No items for checkout quote');

    const now = new Date();
    const hasAccess = Boolean(user.accessMemberUntil && user.accessMemberUntil > now);
    let subtotalRetail = 0;
    let subtotalApplied = 0;
    const lines = [];

    for (const item of items) {
      const product = await prisma.product.findUnique({
        where: { publicId: item.productId },
        include: { variants: true },
      });
      if (!product) throw new AppError(404, 'Product not found');

      const quantity = Math.max(1, Number(item.quantity || 1));
      let variant = null;
      if (item.variantId) {
        variant = product.variants.find((v) => v.publicId === item.variantId) || null;
        if (!variant) throw new AppError(404, 'Variant not found');
      }

      const { unitRetail, unitApplied } = computeAppliedUnitPrice(product, variant, hasAccess);

      subtotalRetail += unitRetail * quantity;
      subtotalApplied += unitApplied * quantity;
      lines.push({
        productId: product.publicId,
        variantId: variant?.publicId || null,
        name: product.name,
        quantity,
        retailUnitPrice: unitRetail,
        appliedUnitPrice: unitApplied,
        lineTotal: unitApplied * quantity,
        condition: product.productType,
        sizeAgeGroup: product.sizeAgeGroup || null,
      });
    }

    const accessDiscount = Math.max(0, subtotalRetail - subtotalApplied);
    const shippingRates = await shippingService.getRates({
      shippingAddress: payload?.shippingAddress,
      parcels: payload?.parcels,
      preferProviderOnly: false,
    });
    const selectedRate = resolveSelectedRate(shippingRates.rates, payload?.selectedRateId, payload?.selectedRate);
    const shippingCost = Number(selectedRate?.amount || 0);

    let availableStoreCredit = 0;
    try {
      const wallet = await prisma.storeCreditWallet.findUnique({
        where: { userId: user.id },
        select: { balance: true },
      });
      availableStoreCredit = wallet?.balance || 0;
    } catch (error) {
      if (!isMissingWalletTableError(error)) {
        throw error;
      }
      // Wallet tables may not be migrated yet in some environments.
      availableStoreCredit = 0;
    }
    const requestedStoreCredit = Number(payload?.storeCreditToApply || 0);
    const storeCreditApplied = Math.max(0, Math.min(requestedStoreCredit, availableStoreCredit, subtotalApplied + shippingCost));
    const totalPayable = Math.max(0, subtotalApplied + shippingCost - storeCreditApplied);

    const accessPricingLineCount = lines.filter((l) => l.retailUnitPrice > l.appliedUnitPrice).length;

    return {
      hasAccess,
      accessPricingLineCount,
      lines,
      shippingEstimate: {
        cost: shippingCost,
        provider: shippingRates.provider,
        shipmentId: shippingRates.shipmentId || null,
        selectedRate,
        rates: shippingRates.rates || [],
        zone: selectedRate ? 'dynamic' : 'unknown',
        description: selectedRate
          ? `${selectedRate.provider} ${selectedRate.serviceLevel || 'shipping'}`
          : 'Shipping estimate unavailable',
      },
      pricing: {
        subtotalRetail,
        subtotalApplied,
        accessDiscount,
        shippingCost,
        storeCreditAvailable: availableStoreCredit,
        storeCreditApplied,
        totalPayable,
      },
    };
  }

  async getUserOrders(userPublicId, page = 1, limit = 10) {
    const user = await prisma.user.findUnique({
      where: { publicId: userPublicId },
      select: { id: true },
    });
    if (!user) {
      throw new AppError(401, 'Unauthorized');
    }

    const skip = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where: { userId: user.id },
        skip,
        take: limit,
        include: { orderItems: { include: { product: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.order.count({ where: { userId: user.id } }),
    ]);

    return {
      orders,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async getOrderById(orderPublicId, userPublicId) {
    const [order, viewer] = await Promise.all([
      prisma.order.findUnique({
        where: { publicId: orderPublicId },
        include: { orderItems: { include: { product: true } } },
      }),
      prisma.user.findUnique({
        where: { publicId: userPublicId },
        select: { id: true },
      }),
    ]);

    if (!order) {
      throw new AppError(404, 'Order not found');
    }
    if (!viewer) {
      throw new AppError(401, 'Unauthorized');
    }
    if (order.userId !== viewer.id) {
      throw new AppError(403, 'Unauthorized to access this order');
    }

    return order;
  }

  async createOrder(userPublicId, items) {
    const user = await prisma.user.findUnique({
      where: { publicId: userPublicId },
      select: { id: true },
    });
    if (!user) {
      throw new AppError(401, 'Unauthorized');
    }

    let totalAmount = 0;

    return prisma.$transaction(async (tx) => {
      const products = [];
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        const product = await tx.product.findUnique({
          where: { publicId: item.productId },
          include: { variants: { orderBy: { sortOrder: 'asc' } } },
        });
        if (!product) {
          throw new AppError(404, `Product not found for item ${index + 1}`);
        }
        totalAmount += product.price * item.quantity;
        products.push(product);
      }

      for (let index = 0; index < items.length; index += 1) {
        await assertAndDecrementOrderStock(tx, products[index], items[index].quantity);
      }

      const order = await tx.order.create({
        data: {
          userId: user.id,
          totalAmount,
          paymentStatus: 'PAID',
          orderItems: {
            create: items.map((item, index) => ({
              productId: products[index].id,
              quantity: item.quantity,
              price: products[index].price,
            })),
          },
        },
        include: { orderItems: { include: { product: true } } },
      });

      return order;
    });
  }

  /**
   * Unpaid order for Stripe Checkout — stock validated but not decremented until webhook payment success.
   */
  async createPendingOrderForStripe(userPublicId, items, opts = {}) {
    const user = await prisma.user.findUnique({
      where: { publicId: userPublicId },
      select: { id: true, accessMemberUntil: true },
    });
    if (!user) {
      throw new AppError(401, 'Unauthorized');
    }

    const now = new Date();
    const hasAccess = Boolean(user.accessMemberUntil && user.accessMemberUntil > now);

    let totalAmount = 0;

    return prisma.$transaction(async (tx) => {
      const products = [];
      const lineCreates = [];
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

        if (item.variantId) {
          const v = product.variants.find((x) => x.publicId === item.variantId);
          if (!v) {
            throw new AppError(404, `Variant not found for item ${index + 1}`);
          }
          if (v.stock < item.quantity) {
            throw new AppError(400, `Insufficient stock for "${product.name}"`);
          }
          variant = v;
          variantDbId = v.id;
        } else {
          assertStockAvailable(product, item.quantity);
        }

        const { unitApplied } = computeAppliedUnitPrice(product, variant, hasAccess);
        const unitPrice = unitApplied;

        totalAmount += unitPrice * item.quantity;
        products.push(product);
        lineCreates.push({
          productId: product.id,
          productVariantId: variantDbId,
          quantity: item.quantity,
          price: unitPrice,
        });
      }

      const order = await tx.order.create({
        data: {
          userId: user.id,
          totalAmount,
          paymentStatus: 'UNPAID',
          status: 'PENDING',
          shippingCost: 0,
          shippingAddressJson: opts.shippingAddress ?? null,
          billingAddressJson: opts.billingAddress ?? null,
          shippingCarrier: null,
          orderItems: {
            create: lineCreates,
          },
        },
        include: { orderItems: { include: { product: true } } },
      });

      const shippingRates = await shippingService.getRates({
        shippingAddress: opts.shippingAddress,
        parcels: opts.parcels,
        preferProviderOnly: false,
      });
      const selectedRate = resolveSelectedRate(shippingRates.rates, opts.selectedRateId, opts.selectedRate);
      const shippingCost = Number(selectedRate?.amount || 0);

      await tx.order.update({
        where: { id: order.id },
        data: {
          shippingCost,
          shippingCarrier: selectedRate?.provider || null,
          ...selectedRateUpdateData(selectedRate, shippingRates.shipmentId || null),
        },
      });

      if (opts.storeCreditToApply && Number(opts.storeCreditToApply) > 0) {
        try {
          const wallet = await tx.storeCreditWallet.findUnique({ where: { userId: user.id } });
          if (wallet && wallet.balance > 0) {
            const capped = Math.min(Number(opts.storeCreditToApply), wallet.balance, order.totalAmount + shippingCost);
            if (capped > 0) {
              await tx.storeCreditWallet.update({
                where: { id: wallet.id },
                data: { balance: wallet.balance - capped },
              });
              await tx.storeCreditTransaction.create({
                data: {
                  walletId: wallet.id,
                  type: 'REDEEMED',
                  amount: -capped,
                  note: `Applied on checkout for order ${order.publicId}`,
                },
              });
              await tx.order.update({
                where: { id: order.id },
                data: { totalAmount: Math.max(0, order.totalAmount + shippingCost - capped) },
              });
            }
          }
        } catch (error) {
          if (!isMissingWalletTableError(error)) {
            throw error;
          }
          // Keep checkout available even if wallet schema isn't migrated.
        }
      }

      return order;
    });
  }

  async fulfillUnpaidOrderAfterPayment(orderPublicId) {
    return prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { publicId: orderPublicId },
        include: { orderItems: true },
      });
      if (!order) {
        throw new AppError(404, 'Order not found');
      }
      if (order.paymentStatus === 'PAID') {
        return order;
      }

      for (const line of order.orderItems) {
        const product = await tx.product.findUnique({
          where: { id: line.productId },
          include: { variants: { orderBy: { sortOrder: 'asc' } } },
        });
        if (line.productVariantId) {
          const v = await tx.productVariant.findUnique({
            where: { id: line.productVariantId },
          });
          if (!v || v.stock < line.quantity) {
            throw new AppError(400, `Insufficient stock for "${product.name}"`);
          }
          await tx.productVariant.update({
            where: { id: v.id },
            data: { stock: v.stock - line.quantity },
          });
          await syncParentStockFromVariants(tx, product.id);
        } else {
          await assertAndDecrementOrderStock(tx, product, line.quantity);
        }
      }

      return tx.order.update({
        where: { id: order.id },
        data: { paymentStatus: 'PAID', status: 'PROCESSING' },
        include: { orderItems: { include: { product: true } } },
      });
    });
  }

  async updateOrderStatus(orderPublicId, status, actor) {
    const order = await prisma.order.findUnique({
      where: { publicId: orderPublicId },
    });

    if (!order) {
      throw new AppError(404, 'Order not found');
    }

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { status },
      include: { orderItems: { include: { product: true } }, user: userForOrderList },
    });
    await writeAdminAudit({
      actorId: actor?.id,
      actorEmail: actor?.email,
      action: 'ORDER_STATUS',
      entityType: 'Order',
      entityId: orderPublicId,
      meta: { from: order.status, to: status },
    });
    return updated;
  }

  async getAdminOrderStats() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const [monthTotal, pendingFulfillment, pendingCancellation] = await Promise.all([
      prisma.order.count({ where: { createdAt: { gte: monthStart } } }),
      prisma.order.count({
        where: { status: { in: ['PENDING', 'PROCESSING', 'CONFIRMED'] } },
      }),
      prisma.order.count({ where: { cancellationReviewStatus: 'PENDING' } }),
    ]);
    return { monthTotal, pendingFulfillment, pendingCancellation };
  }

  async getAllOrders(page = 1, limit = 20, filters = {}) {
    const skip = (page - 1) * limit;
    const {
      search,
      status,
      statusGroup,
      dateFrom,
      dateTo,
      cancellationReviewStatus,
      membershipFilter,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = filters;

    const STATUS_GROUPS = {
      pending: ['PENDING', 'PROCESSING', 'CONFIRMED'],
      shipped: ['SHIPPED'],
      delivered: ['DELIVERED'],
      cancelled: ['CANCELLED'],
      returned: ['RETURNED'],
    };

    const and = [];
    const sg = statusGroup && String(statusGroup).trim();
    const st = status && String(status).trim();
    if (sg && STATUS_GROUPS[sg]) {
      if (st && STATUS_GROUPS[sg].includes(st)) {
        and.push({ status: st });
      } else if (st && !STATUS_GROUPS[sg].includes(st)) {
        and.push({ id: -1 });
      } else {
        and.push({ status: { in: STATUS_GROUPS[sg] } });
      }
    } else if (st) {
      and.push({ status: st });
    }
    if (cancellationReviewStatus && String(cancellationReviewStatus).trim()) {
      and.push({ cancellationReviewStatus: String(cancellationReviewStatus).trim() });
    }
    const mf = membershipFilter && String(membershipFilter).trim();
    if (mf === 'access') {
      and.push({ user: { accessMemberUntil: { gt: new Date() } } });
    } else if (mf === 'standard') {
      and.push({
        OR: [
          { user: { accessMemberUntil: null } },
          { user: { accessMemberUntil: { lte: new Date() } } },
        ],
      });
    }
    if (dateFrom || dateTo) {
      const range = {};
      if (dateFrom) range.gte = new Date(dateFrom);
      if (dateTo) {
        const e = new Date(dateTo);
        e.setHours(23, 59, 59, 999);
        range.lte = e;
      }
      and.push({ createdAt: range });
    }
    if (search && String(search).trim()) {
      const q = String(search).trim();
      and.push({
        OR: [
          { publicId: { contains: q, mode: 'insensitive' } },
          { user: { email: { contains: q, mode: 'insensitive' } } },
          { user: { firstName: { contains: q, mode: 'insensitive' } } },
          { user: { lastName: { contains: q, mode: 'insensitive' } } },
        ],
      });
    }
    const where = and.length ? { AND: and } : {};

    const so = sortOrder === 'asc' ? 'asc' : 'desc';
    let orderBy = { createdAt: so };
    if (sortBy === 'totalAmount') {
      orderBy = { totalAmount: so };
    } else if (sortBy === 'status') {
      orderBy = { status: so };
    } else if (sortBy === 'createdAt') {
      orderBy = { createdAt: so };
    }

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip,
        take: limit,
        include: {
          orderItems: { include: { product: true } },
          user: userForOrderList,
        },
        orderBy,
      }),
      prisma.order.count({ where }),
    ]);

    return {
      orders,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async getOrderForAdmin(orderPublicId) {
    const order = await prisma.order.findUnique({
      where: { publicId: orderPublicId },
      include: {
        user: {
          select: {
            publicId: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            accessMemberUntil: true,
          },
        },
        orderItems: {
          include: {
            product: {
              select: {
                publicId: true,
                name: true,
                sku: true,
                productType: true,
                imageUrl: true,
                price: true,
              },
            },
            productVariant: {
              select: { publicId: true, sku: true, combination: true, priceOverride: true },
            },
          },
        },
      },
    });
    if (!order) {
      throw new AppError(404, 'Order not found');
    }
    return order;
  }

  async refundOrder(orderPublicId, actor) {
    const order = await prisma.order.findUnique({ where: { publicId: orderPublicId } });
    if (!order) throw new AppError(404, 'Order not found');
    if (order.paymentStatus !== 'PAID') {
      throw new AppError(400, 'Only paid orders can be marked refunded');
    }
    if (order.status === 'REFUNDED' || order.paymentStatus === 'REFUNDED') {
      throw new AppError(400, 'Order already refunded');
    }
    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { status: 'REFUNDED', paymentStatus: 'REFUNDED' },
      include: { orderItems: { include: { product: true } }, user: userForOrderList },
    });
    await writeAdminAudit({
      actorId: actor?.id,
      actorEmail: actor?.email,
      action: 'ORDER_REFUND',
      entityType: 'Order',
      entityId: orderPublicId,
      meta: { totalAmount: order.totalAmount, shippingCost: order.shippingCost },
    });
    return updated;
  }

  async updateAdminShipping(orderPublicId, payload) {
    const order = await prisma.order.findUnique({ where: { publicId: orderPublicId } });
    if (!order) throw new AppError(404, 'Order not found');
    const data = {};
    if (payload.trackingNumber != null && String(payload.trackingNumber).trim()) {
      data.trackingNumber = String(payload.trackingNumber).trim();
    }
    if (payload.shippingCarrier != null && String(payload.shippingCarrier).trim()) {
      data.shippingCarrier = String(payload.shippingCarrier).trim();
    }
    if (payload.shippingLabelUrl !== undefined) {
      data.shippingLabelUrl = payload.shippingLabelUrl ? String(payload.shippingLabelUrl).trim() : null;
    }
    const shouldShip =
      data.trackingNumber &&
      ['PENDING', 'PROCESSING', 'CONFIRMED'].includes(order.status);
    if (shouldShip) {
      data.status = 'SHIPPED';
    }
    return prisma.order.update({
      where: { id: order.id },
      data,
      include: { orderItems: { include: { product: true } }, user: userForOrderList },
    });
  }

  async getAdminShippingOptions(orderPublicId, payload = {}) {
    const order = await prisma.order.findUnique({
      where: { publicId: orderPublicId },
      select: { id: true, shippingAddressJson: true },
    });
    if (!order) throw new AppError(404, 'Order not found');
    if (!order.shippingAddressJson) {
      throw new AppError(400, 'Order does not have a shipping address', 'SHIPPING_ADDRESS_MISSING');
    }
    const ratesData = await shippingService.getRates({
      shippingAddress: order.shippingAddressJson,
      parcels: payload.parcels,
      preferProviderOnly: true,
    });
    const carrierFilter = String(payload.carrier || '').trim().toLowerCase();
    const rates = carrierFilter
      ? (ratesData.rates || []).filter((r) =>
          String(r.provider || '').toLowerCase().includes(carrierFilter)
        )
      : ratesData.rates || [];
    const carriers = [...new Set((ratesData.rates || []).map((r) => String(r.provider || '').trim()).filter(Boolean))];
    return {
      shipmentId: ratesData.shipmentId,
      carriers,
      rates,
      diagnostics: ratesData.diagnostics || null,
    };
  }

  async getAdminReturnShippingOptions(orderPublicId, payload = {}) {
    const order = await prisma.order.findUnique({
      where: { publicId: orderPublicId },
      select: { id: true, shippingAddressJson: true },
    });
    if (!order) throw new AppError(404, 'Order not found');
    if (!order.shippingAddressJson) {
      throw new AppError(400, 'Order does not have a shipping address', 'SHIPPING_ADDRESS_MISSING');
    }
    const ratesData = await shippingService.getRates({
      fromAddress: order.shippingAddressJson,
      toAddress: shippingService.getConfiguredOriginAddress(),
      parcels: payload.parcels,
      preferProviderOnly: true,
    });
    const carrierFilter = String(payload.carrier || '').trim().toLowerCase();
    const rates = carrierFilter
      ? (ratesData.rates || []).filter((r) =>
          String(r.provider || '').toLowerCase().includes(carrierFilter)
        )
      : ratesData.rates || [];
    const carriers = [...new Set((ratesData.rates || []).map((r) => String(r.provider || '').trim()).filter(Boolean))];
    return {
      shipmentId: ratesData.shipmentId,
      carriers,
      rates,
      diagnostics: ratesData.diagnostics || null,
    };
  }

  async generateAdminShippingLabel(orderPublicId, payload, actor) {
    const order = await prisma.order.findUnique({ where: { publicId: orderPublicId } });
    if (!order) throw new AppError(404, 'Order not found');
    const label = await shippingService.generateLabel(payload);
    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        ...(label.trackingNumber ? { trackingNumber: label.trackingNumber } : {}),
        ...(label.shippingCarrier ? { shippingCarrier: label.shippingCarrier } : {}),
        ...(label.shippingLabelUrl ? { shippingLabelUrl: label.shippingLabelUrl } : {}),
        ...(label.transactionId ? { shippingTransactionId: label.transactionId } : {}),
        ...(payload?.shipmentId ? { shippingShipmentId: String(payload.shipmentId) } : {}),
        ...(payload?.selectedRate ? selectedRateUpdateData(payload.selectedRate, payload?.shipmentId || order.shippingShipmentId) : {}),
        ...(['PENDING', 'PROCESSING', 'CONFIRMED'].includes(order.status) ? { status: 'SHIPPED' } : {}),
      },
      include: { orderItems: { include: { product: true } }, user: userForOrderList },
    });
    await writeAdminAudit({
      actorId: actor?.id,
      actorEmail: actor?.email,
      action: 'ORDER_LABEL_PURCHASED',
      entityType: 'Order',
      entityId: orderPublicId,
      meta: {
        rateId: payload?.rateId,
        labelFileType: payload?.labelFileType || 'PDF_4x6',
        trackingNumber: label.trackingNumber || null,
      },
    });
    return { order: updated, label };
  }

  async generateAdminReturnLabel(orderPublicId, payload, actor) {
    const order = await prisma.order.findUnique({ where: { publicId: orderPublicId } });
    if (!order) throw new AppError(404, 'Order not found');
    const label = await shippingService.generateLabel(payload);
    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        ...(payload?.shipmentId ? { returnShipmentId: String(payload.shipmentId) } : {}),
        ...(label.shippingLabelUrl ? { returnLabelUrl: label.shippingLabelUrl } : {}),
        ...(label.trackingNumber ? { returnTrackingNumber: label.trackingNumber } : {}),
        ...(label.shippingCarrier ? { returnShippingCarrier: label.shippingCarrier } : {}),
        ...(label.transactionId ? { returnTransactionId: label.transactionId } : {}),
      },
      include: { orderItems: { include: { product: true } }, user: userForOrderList },
    });
    await writeAdminAudit({
      actorId: actor?.id,
      actorEmail: actor?.email,
      action: 'ORDER_RETURN_LABEL_PURCHASED',
      entityType: 'Order',
      entityId: orderPublicId,
      meta: {
        rateId: payload?.rateId,
        labelFileType: payload?.labelFileType || 'PDF_4x6',
        trackingNumber: label.trackingNumber || null,
      },
    });
    return { order: updated, label };
  }

  async addTracking(orderPublicId, tracking) {
    const order = await prisma.order.findUnique({ where: { publicId: orderPublicId } });
    if (!order) throw new AppError(404, 'Order not found');
    return prisma.order.update({
      where: { id: order.id },
      data: {
        trackingNumber: tracking.trackingNumber,
        shippingCarrier: tracking.shippingCarrier || order.shippingCarrier || null,
        trackingStatus: tracking.status || null,
        trackingStatusDetails: tracking.statusDetails || null,
        trackingStatusDate: parseDateOrNull(tracking.statusDate),
        trackingEta: parseDateOrNull(tracking.eta),
        trackingHistoryJson: Array.isArray(tracking.history) ? tracking.history : [],
        ...(tracking.shippingLabelUrl !== undefined
          ? { shippingLabelUrl: tracking.shippingLabelUrl || null }
          : {}),
        ...(order.status === 'PROCESSING' || order.status === 'CONFIRMED' || order.status === 'PENDING'
          ? { status: 'SHIPPED' }
          : {}),
      },
    });
  }

  async requestCancellationByUser(orderPublicId, userPublicId, reason) {
    const [order, user] = await Promise.all([
      prisma.order.findUnique({ where: { publicId: orderPublicId } }),
      prisma.user.findUnique({ where: { publicId: userPublicId }, select: { id: true } }),
    ]);
    if (!order) throw new AppError(404, 'Order not found');
    if (!user || order.userId !== user.id) throw new AppError(403, 'Unauthorized to cancel this order');
    if (['SHIPPED', 'DELIVERED', 'RETURNED', 'REFUNDED'].includes(order.status)) {
      throw new AppError(400, 'Order can no longer be canceled');
    }
    if (order.status === 'CANCELLED') return order;
    if (order.cancellationReviewStatus === 'PENDING') {
      return prisma.order.findUnique({
        where: { id: order.id },
        include: { orderItems: { include: { product: true } } },
      });
    }
    return prisma.order.update({
      where: { id: order.id },
      data: {
        cancellationReviewStatus: 'PENDING',
        cancellationRequestedAt: new Date(),
        cancellationRequestReason: reason?.trim() || null,
        cancellationReviewNote: null,
      },
      include: { orderItems: { include: { product: true } } },
    });
  }

  async reviewCancellationOrder(orderPublicId, { decision, note }, actor) {
    const order = await prisma.order.findUnique({ where: { publicId: orderPublicId } });
    if (!order) throw new AppError(404, 'Order not found');
    if (order.cancellationReviewStatus !== 'PENDING') {
      throw new AppError(400, 'No pending cancellation request for this order');
    }
    if (decision === 'approve') {
      const updated = await prisma.order.update({
        where: { id: order.id },
        data: {
          status: 'CANCELLED',
          cancellationReviewStatus: 'APPROVED',
          cancellationReviewNote: note?.trim() || null,
          ...(order.paymentStatus === 'PAID' ? { paymentStatus: 'FAILED' } : {}),
        },
        include: { orderItems: { include: { product: true } }, user: userForOrderList },
      });
      await writeAdminAudit({
        actorId: actor?.id,
        actorEmail: actor?.email,
        action: 'CANCELLATION_APPROVED',
        entityType: 'Order',
        entityId: orderPublicId,
        meta: { note: note?.trim() || null },
      });
      return updated;
    }
    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        cancellationReviewStatus: 'REJECTED',
        cancellationReviewNote: note?.trim() || null,
        cancellationRequestedAt: null,
        cancellationRequestReason: null,
      },
      include: { orderItems: { include: { product: true } }, user: userForOrderList },
    });
    await writeAdminAudit({
      actorId: actor?.id,
      actorEmail: actor?.email,
      action: 'CANCELLATION_REJECTED',
      entityType: 'Order',
      entityId: orderPublicId,
      meta: { note: note?.trim() || null },
    });
    return updated;
  }
}

export const orderService = new OrderService();
