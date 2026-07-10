import { prisma } from '../lib/prisma.js';
import { AppError } from '../utils/error-handler.js';
import { AGE_AXIS_NAME, isCanonicalAge } from '../lib/age-groups.js';

/** Canonical Age from a variant's combination, or null when absent/invalid. */
function variantAgeGroup(variant) {
  const combo = variant?.combination;
  const age = combo && typeof combo === 'object' ? combo[AGE_AXIS_NAME] : null;
  return isCanonicalAge(age) ? String(age).trim() : null;
}
import {
  assertAndDecrementOrderStock,
  assertStockAvailable,
  syncParentStockFromVariants,
} from './inventory.service.js';
import {
  commitOrderLineStock,
  releaseOrderLineStock,
  reserveOrderLineStock,
  variantAvailableStock,
} from './inventory-reservation.js';
import { walletService } from './wallet.service.js';
import { shippingService } from './shipping.service.js';
import { writeAdminAudit } from './audit.service.js';
import {
  canCustomerCancelOrder,
  customerCancelUnavailableReason,
} from '../lib/customer-order-cancellation.js';
import * as orderDocuments from './pdf/order-documents.service.js';
import { emailService } from './email.service.js';
import { config } from '../config/env.js';
import { verifyOrderTrackingToken } from '../lib/order-tracking-token.js';
import { assignOrderNumber, placeholderOrderNumber } from '../utils/order-number.js';
import {
  buildCheckoutSignature,
  buildCheckoutSignatureFromOrder,
} from '../utils/checkout-signature.js';
import { buildParcelsForOrder } from './shipping/order-parcels.js';
import { assertMembershipCheckoutAllowed } from './membership-eligibility.service.js';
import fs from 'fs';
import path from 'path';
import { SHIPPING_LABELS_DIR } from '../utils/product-upload.js';

const orderItemAdminInclude = {
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
  pickedBy: {
    select: {
      publicId: true,
      email: true,
      firstName: true,
      lastName: true,
    },
  },
};

const orderItemCustomerInclude = {
  product: {
    select: {
      id: true,
      publicId: true,
      name: true,
      slug: true,
      sku: true,
      productType: true,
      sizeAgeGroup: true,
      imageUrl: true,
      price: true,
      memberPrice: true,
      compareAtPrice: true,
    },
  },
  productVariant: {
    select: {
      id: true,
      publicId: true,
      sku: true,
      combination: true,
      imageUrl: true,
    },
  },
};

async function resolveActorUserId(actor) {
  if (!actor?.id) return null;
  const user = await prisma.user.findUnique({
    where: { publicId: actor.id },
    select: { id: true },
  });
  return user?.id ?? null;
}

let ensureOrderCheckoutColumnsPromise = null;

function isSchemaBootstrapSkippableError(error) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  const msg = String(error?.message || '');
  return (
    code === '42501' ||
    /must be owner of table|permission denied|insufficient privilege/i.test(msg)
  );
}

async function ensureOrderCheckoutColumns() {
  if (!ensureOrderCheckoutColumnsPromise) {
    ensureOrderCheckoutColumnsPromise = prisma
      .$executeRawUnsafe(`
      ALTER TABLE "Order"
        ADD COLUMN IF NOT EXISTS "shippingCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "shippingAddressJson" JSONB,
        ADD COLUMN IF NOT EXISTS "billingAddressJson" JSONB,
        ADD COLUMN IF NOT EXISTS "shippingCarrier" TEXT,
        ADD COLUMN IF NOT EXISTS "selectedRateId" TEXT,
        ADD COLUMN IF NOT EXISTS "selectedRateProvider" TEXT,
        ADD COLUMN IF NOT EXISTS "selectedRateServiceLevel" TEXT,
        ADD COLUMN IF NOT EXISTS "selectedRateServiceToken" TEXT,
        ADD COLUMN IF NOT EXISTS "selectedRateAmount" DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS "selectedRateCurrency" TEXT,
        ADD COLUMN IF NOT EXISTS "selectedRateEstimatedDays" INTEGER,
        ADD COLUMN IF NOT EXISTS "shippingShipmentId" TEXT,
        ADD COLUMN IF NOT EXISTS "shippingTransactionId" TEXT,
        ADD COLUMN IF NOT EXISTS "returnShipmentId" TEXT,
        ADD COLUMN IF NOT EXISTS "returnLabelUrl" TEXT,
        ADD COLUMN IF NOT EXISTS "returnTrackingNumber" TEXT,
        ADD COLUMN IF NOT EXISTS "returnShippingCarrier" TEXT,
        ADD COLUMN IF NOT EXISTS "returnTransactionId" TEXT,
        ADD COLUMN IF NOT EXISTS "trackingStatus" TEXT,
        ADD COLUMN IF NOT EXISTS "trackingStatusDetails" TEXT,
        ADD COLUMN IF NOT EXISTS "trackingStatusDate" TIMESTAMP(3),
        ADD COLUMN IF NOT EXISTS "trackingEta" TIMESTAMP(3),
        ADD COLUMN IF NOT EXISTS "trackingHistoryJson" JSONB,
        ADD COLUMN IF NOT EXISTS "stripeCheckoutSessionId" TEXT;
    `)
      .catch((error) => {
        ensureOrderCheckoutColumnsPromise = null;
        if (isSchemaBootstrapSkippableError(error)) {
          console.warn(
            '[order] checkout column bootstrap skipped (run prisma migrate deploy as DB owner)'
          );
          return;
        }
        throw error;
      });
  }
  await ensureOrderCheckoutColumnsPromise;
}

/** Same rules as checkout quote: variant override, then ACCESS memberPrice cap when eligible. */
function computeAppliedUnitPrice(product, variant, hasAccess) {
  let unitRetail = Number(product.price);
  let unitApplied = unitRetail;
  if (variant) {
    const vPrice = variant.priceOverride != null ? Number(variant.priceOverride) : unitRetail;
    unitRetail = vPrice;
    unitApplied = vPrice;
  }
  const variantMember =
    variant?.memberPriceOverride != null ? Number(variant.memberPriceOverride) : null;
  const productMember = product.memberPrice != null ? Number(product.memberPrice) : null;
  const memberCap = variantMember != null && variantMember > 0 ? variantMember : productMember;
  if (hasAccess && memberCap != null && memberCap > 0) {
    unitApplied = Math.min(unitApplied, memberCap);
  }
  return { unitRetail, unitApplied };
}

/** Persisted line pricing snapshot for orders and checkout intents. */
function buildOrderLinePricing(product, variant, effectiveHasAccess) {
  const { unitRetail, unitApplied } = computeAppliedUnitPrice(product, variant, effectiveHasAccess);
  const pricingTier =
    effectiveHasAccess && unitApplied < unitRetail ? 'ACCESS' : 'STANDARD';
  // Variant-aware Members Price at purchase — captured regardless of buyer's access state.
  const memberPriceSnapshot = computeAppliedUnitPrice(product, variant, true).unitApplied;
  return {
    price: unitApplied,
    retailUnitPrice: unitRetail,
    pricingTier,
    memberPriceSnapshot,
  };
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
    isGuest: true,
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

/** Match equivalent service tier across rate lists (ACCESS vs standard amounts differ). */
function matchRateByServiceTier(rates, reference) {
  const list = Array.isArray(rates) ? rates : [];
  if (list.length === 0) return null;
  if (!reference || typeof reference !== 'object') return list[0] || null;
  const token = String(reference.serviceToken || '').trim().toLowerCase();
  const level = String(reference.serviceLevel || '').trim().toLowerCase();
  const provider = String(reference.provider || '').trim().toLowerCase();
  if (token) {
    const byToken = list.find((rate) => String(rate?.serviceToken || '').trim().toLowerCase() === token);
    if (byToken) return byToken;
  }
  if (level) {
    const byLevel = list.find((rate) => String(rate?.serviceLevel || '').trim().toLowerCase() === level);
    if (byLevel) return byLevel;
  }
  if (provider) {
    const byProvider = list.find((rate) => String(rate?.provider || '').trim().toLowerCase() === provider);
    if (byProvider) return byProvider;
  }
  return list[0] || null;
}

export class OrderService {
  async calculateCheckoutQuote(userPublicId, payload) {
    const user = await prisma.user.findUnique({
      where: { publicId: userPublicId },
      select: { id: true, accessMemberUntil: true, babyName: true, isGuest: true },
    });
    if (!user) throw new AppError(401, 'Unauthorized');
    const items = Array.isArray(payload?.items) ? payload.items : [];
    if (items.length === 0) throw new AppError(400, 'No items for checkout quote');

    const now = new Date();
    const hasAccess = Boolean(user.accessMemberUntil && user.accessMemberUntil > now);
    let includeAccessMembership = Boolean(payload?.includeAccessMembership);
    if (user.isGuest && includeAccessMembership) {
      throw new AppError(
        403,
        'ACCESS membership requires a full account. Please sign in or create an account.',
        'FULL_ACCOUNT_REQUIRED'
      );
    }
    if (includeAccessMembership && hasAccess) {
      includeAccessMembership = false;
    }
    if (includeAccessMembership) {
      await assertMembershipCheckoutAllowed(userPublicId, { intent: 'purchase' });
    }
    const effectiveHasAccess = hasAccess || includeAccessMembership;
    let subtotalRetail = 0;
    let subtotalApplied = 0;
    let memberSubtotalIfAccess = 0;
    let potentialAccessPricingLineCount = 0;
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

      const linePricing = buildOrderLinePricing(product, variant, effectiveHasAccess);
      if (!hasAccess) {
        const memberLinePricing = buildOrderLinePricing(product, variant, true);
        memberSubtotalIfAccess += memberLinePricing.price * quantity;
        if (memberLinePricing.pricingTier === 'ACCESS') {
          potentialAccessPricingLineCount += 1;
        }
      }

      subtotalRetail += linePricing.retailUnitPrice * quantity;
      subtotalApplied += linePricing.price * quantity;
      lines.push({
        productId: product.publicId,
        variantId: variant?.publicId || null,
        name: product.name,
        quantity,
        retailUnitPrice: linePricing.retailUnitPrice,
        appliedUnitPrice: linePricing.price,
        pricingTier: linePricing.pricingTier,
        lineTotal: linePricing.price * quantity,
        condition: product.productType,
        sizeAgeGroup: variantAgeGroup(variant) || product.sizeAgeGroup || null,
      });
    }

    const accessDiscount = Math.max(0, subtotalRetail - subtotalApplied);
    const { getBusinessSettings } = await import('./admin.service.js');
    const settings = await getBusinessSettings();
    const accessMembershipAnnualFee = Number(settings.accessMembershipPriceUsd || 50);
    const accessMembershipFee = includeAccessMembership ? accessMembershipAnnualFee : 0;
    const shippingRates = await shippingService.getRates({
      shippingAddress: payload?.shippingAddress,
      parcels: payload?.parcels,
      preferProviderOnly: false,
      surface: 'checkout',
      hasAccess: effectiveHasAccess,
    });
    const selectedRate = resolveSelectedRate(shippingRates.rates, payload?.selectedRateId, payload?.selectedRate);
    const shippingCost = Number(selectedRate?.amount || 0);

    let accessSavings = null;
    if (!hasAccess) {
      const itemSavings = includeAccessMembership
        ? accessDiscount
        : Math.max(0, subtotalApplied - memberSubtotalIfAccess);
      let shippingSavings = 0;
      const compareShippingRates = await shippingService.getRates({
        shippingAddress: payload?.shippingAddress,
        parcels: payload?.parcels,
        preferProviderOnly: false,
        surface: 'checkout',
        hasAccess: !includeAccessMembership,
      });
      const compareRate = matchRateByServiceTier(compareShippingRates.rates, selectedRate);
      const compareShippingCost = Number(compareRate?.amount || 0);
      shippingSavings = Math.max(
        0,
        includeAccessMembership ? compareShippingCost - shippingCost : shippingCost - compareShippingCost
      );
      const totalSavings = Math.round((itemSavings + shippingSavings) * 100) / 100;
      accessSavings = {
        itemSavings: Math.round(itemSavings * 100) / 100,
        shippingSavings: Math.round(shippingSavings * 100) / 100,
        totalSavings,
        eligibleLineCount: potentialAccessPricingLineCount,
        annualFee: accessMembershipAnnualFee,
        netAnnualCostAfterToday: Math.max(0, Math.round((accessMembershipAnnualFee - totalSavings) * 100) / 100),
      };
    }

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
    const storeCreditApplied = Math.max(
      0,
      Math.min(requestedStoreCredit, availableStoreCredit, subtotalApplied + shippingCost + accessMembershipFee)
    );
    // Tax applies to the product cost only — shipping and the ACCESS membership
    // fee are excluded from the taxable base.
    const taxAmount =
      Math.round(
        Math.max(0, subtotalApplied - storeCreditApplied) * config.salesTaxRate * 100
      ) / 100;
    const totalPayable = Math.max(
      0,
      subtotalApplied + shippingCost + accessMembershipFee - storeCreditApplied + taxAmount
    );

    const accessPricingLineCount = lines.filter((l) => l.pricingTier === 'ACCESS').length;

    return {
      hasAccess: effectiveHasAccess,
      includeAccessMembership,
      accessMembershipFee,
      accessMembershipAnnualFee: hasAccess ? 0 : accessMembershipAnnualFee,
      accessPricingLineCount,
      accessSavings,
      lines,
      shippingEstimate: {
        cost: shippingCost,
        provider: shippingRates.provider,
        isDemoRates: String(shippingRates.provider || '').toLowerCase() === 'demo',
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
        accessMembershipFee,
        shippingCost,
        storeCreditAvailable: availableStoreCredit,
        storeCreditApplied,
        taxAmount,
        totalPayable,
      },
    };
  }

  buildUserOrderListWhere(userId, filters = {}) {
    const and = [{ userId }];
    const periodMonths = filters.periodMonths != null ? String(filters.periodMonths) : '';
    if (periodMonths && periodMonths !== 'all') {
      const months = Number(periodMonths);
      if (!Number.isNaN(months) && months > 0) {
        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - months);
        and.push({ createdAt: { gte: cutoff } });
      }
    }

    const tab = filters.tab ? String(filters.tab) : 'all';
    const terminalStatuses = ['DELIVERED', 'CANCELLED', 'REFUNDED', 'RETURNED'];

    if (tab === 'delivered') {
      and.push({
        OR: [
          { status: 'DELIVERED' },
          { fulfillmentStatus: 'DELIVERED' },
          { deliveredAt: { not: null } },
        ],
      });
    } else if (tab === 'active') {
      and.push({
        deliveredAt: null,
        status: { notIn: terminalStatuses },
        NOT: { fulfillmentStatus: 'DELIVERED' },
      });
    } else if (tab === 'returns') {
      and.push({ returnRequests: { some: {} } });
    }

    const search = filters.search ? String(filters.search).trim() : '';
    if (search) {
      and.push({
        OR: [
          { publicId: { contains: search, mode: 'insensitive' } },
          { orderNumber: { contains: search, mode: 'insensitive' } },
          {
            orderItems: {
              some: { product: { name: { contains: search, mode: 'insensitive' } } },
            },
          },
        ],
      });
    }

    return { AND: and };
  }

  async getUserOrders(userPublicId, page = 1, limit = 10, filters = {}) {
    const user = await prisma.user.findUnique({
      where: { publicId: userPublicId },
      select: { id: true },
    });
    if (!user) {
      throw new AppError(401, 'Unauthorized');
    }

    const skip = (page - 1) * limit;
    const where = this.buildUserOrderListWhere(user.id, filters);

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip,
        take: limit,
        include: {
          orderItems: {
            include: {
              ...orderItemCustomerInclude,
              returnRequests: {
                select: {
                  publicId: true,
                  submissionPublicId: true,
                  status: true,
                  type: true,
                  quantity: true,
                  createdAt: true,
                },
                orderBy: { createdAt: 'desc' },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.order.count({ where }),
    ]);

    return {
      orders,
      pagination: {
        total,
        page,
        limit,
        pages: Math.max(1, Math.ceil(total / limit) || 1),
      },
    };
  }

  async getUserOrderStats(userPublicId, { periodMonths = '12' } = {}) {
    const user = await prisma.user.findUnique({
      where: { publicId: userPublicId },
      select: { id: true },
    });
    if (!user) throw new AppError(401, 'Unauthorized');

    const where = this.buildUserOrderListWhere(user.id, { periodMonths, tab: 'all' });
    const orders = await prisma.order.findMany({
      where,
      select: {
        publicId: true,
        status: true,
        deliveredAt: true,
        trackingNumber: true,
        createdAt: true,
        returnRequests: { select: { id: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const returnOrderIds = new Set(
      orders.filter((o) => o.returnRequests.length > 0).map((o) => o.publicId)
    );
    const isDelivered = (o) =>
      o.status.toUpperCase().includes('DELIVER') || Boolean(o.deliveredAt);
    const isCancelled = (o) => {
      const s = o.status.toUpperCase();
      return s.includes('CANCEL') || s.includes('REFUND');
    };
    const isInTransit = (o) => {
      if (isDelivered(o) || isCancelled(o)) return false;
      const s = o.status.toUpperCase();
      return Boolean(o.trackingNumber) || s.includes('SHIP') || s.includes('TRANSIT');
    };
    const isActive = (o) => !isDelivered(o) && !isCancelled(o) && !isInTransit(o);

    const year = new Date().getFullYear();
    const deliveredThisYear = orders.filter((o) => {
      if (!isDelivered(o)) return false;
      const d = o.deliveredAt ? new Date(o.deliveredAt) : new Date(o.createdAt);
      return d.getFullYear() === year;
    }).length;

    return {
      counts: {
        all: orders.length,
        active: orders.filter((o) => isActive(o) || isInTransit(o)).length,
        delivered: orders.filter(isDelivered).length,
        returns: returnOrderIds.size,
      },
      inTransit: orders.filter(isInTransit).length,
      deliveredThisYear,
    };
  }

  async getOrderById(orderPublicId, userPublicId) {
    const [order, viewer] = await Promise.all([
      prisma.order.findUnique({
        where: { publicId: orderPublicId },
        include: {
          orderItems: {
            include: {
              ...orderItemCustomerInclude,
              returnRequests: {
                select: {
                  publicId: true,
                  submissionPublicId: true,
                  status: true,
                  type: true,
                  quantity: true,
                  createdAt: true,
                },
                orderBy: { createdAt: 'desc' },
              },
            },
          },
        },
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

  async trackPublicOrder({ token, orderNumber, email }) {
    let resolvedOrderNumber = orderNumber ? String(orderNumber).trim() : '';
    let resolvedEmail = email ? String(email).trim().toLowerCase() : '';

    if (token) {
      const verified = verifyOrderTrackingToken(token);
      resolvedOrderNumber = verified.orderNumber;
      resolvedEmail = verified.email;
    }

    if (!resolvedOrderNumber || !resolvedEmail) {
      throw new AppError(400, 'Order number and email are required', 'TRACKING_LOOKUP_REQUIRED');
    }

    const order = await prisma.order.findFirst({
      where: {
        OR: [{ orderNumber: resolvedOrderNumber }, { publicId: resolvedOrderNumber }],
        contactEmail: { equals: resolvedEmail, mode: 'insensitive' },
      },
      include: {
        orderItems: {
          include: {
            product: {
              select: { publicId: true, name: true, slug: true, imageUrl: true },
            },
          },
        },
      },
    });

    if (!order) {
      const fallback = await prisma.order.findFirst({
        where: {
          OR: [{ orderNumber: resolvedOrderNumber }, { publicId: resolvedOrderNumber }],
          user: { email: { equals: resolvedEmail, mode: 'insensitive' } },
        },
        include: {
          orderItems: {
            include: {
              product: {
                select: { publicId: true, name: true, slug: true, imageUrl: true },
              },
            },
          },
        },
      });
      if (!fallback) {
        throw new AppError(404, 'Order not found. Check your order number and email.', 'ORDER_NOT_FOUND');
      }
      return this.formatPublicTrackingOrder(fallback);
    }

    return this.formatPublicTrackingOrder(order);
  }

  formatPublicTrackingOrder(order) {
    const shipping = order.shippingAddressJson && typeof order.shippingAddressJson === 'object'
      ? order.shippingAddressJson
      : null;
    const canCancel = canCustomerCancelOrder(order);
    return {
      id: order.publicId,
      orderNumber: order.orderNumber,
      status: order.status,
      paymentStatus: order.paymentStatus,
      fulfillmentStatus: order.fulfillmentStatus,
      createdAt: order.createdAt,
      totalAmount: Number(order.totalAmount),
      shippingCost: Number(order.shippingCost || 0),
      trackingNumber: order.trackingNumber,
      shippingCarrier: order.shippingCarrier,
      trackingCarrier: order.shippingCarrier,
      placedAsGuest: Boolean(order.placedAsGuest),
      cancellationReviewStatus: order.cancellationReviewStatus || null,
      canCancel,
      cancelUnavailableReason: canCancel ? null : customerCancelUnavailableReason(order),
      items: order.orderItems.map((item) => ({
        // Expose the public cuid as `id` directly so clients don't depend on
        // toPublicJson remapping (and never send a null/undefined item id).
        id: item.publicId,
        quantity: item.quantity,
        unitPrice: Number(item.price),
        lineTotal: Number(item.price) * item.quantity,
        cancelledAt: item.cancelledAt || null,
        product: item.product
          ? {
              id: item.product.publicId,
              name: item.product.name,
              slug: item.product.slug,
              imageUrl: item.product.imageUrl,
            }
          : null,
      })),
      shipping: shipping
        ? {
            city: shipping.city,
            state: shipping.state,
            zipCode: shipping.zipCode || shipping.postalCode,
          }
        : null,
    };
  }

  async createOrder(userPublicId, items) {
    if (config.nodeEnv === 'production') {
      throw new AppError(
        410,
        'Direct order creation is disabled. Use checkout and payment.',
        'USE_CHECKOUT'
      );
    }
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
          orderNumber: placeholderOrderNumber(),
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
      await assignOrderNumber(tx, order.id);

      return tx.order.findUnique({
        where: { id: order.id },
        include: { orderItems: { include: { product: true } } },
      });
    });
  }

  checkoutSignature(items, opts = {}) {
    return buildCheckoutSignature({
      items,
      selectedRateId: opts.selectedRateId,
      storeCreditToApply: opts.storeCreditToApply,
      shippingAddress: opts.shippingAddress,
    });
  }

  async findReusablePendingCheckoutOrder(userId, signature) {
    const since = new Date(Date.now() - config.pendingOrderTtlMinutes * 60 * 1000);
    const candidates = await prisma.order.findMany({
      where: {
        userId,
        paymentStatus: 'UNPAID',
        status: 'PENDING',
        createdAt: { gte: since },
        stripePaymentIntentId: { not: null },
      },
      include: {
        orderItems: {
          include: {
            product: { select: { publicId: true } },
            productVariant: { select: { publicId: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 15,
    });

    for (const order of candidates) {
      if (buildCheckoutSignatureFromOrder(order, order.orderItems) === signature) {
        return order;
      }
    }
    return null;
  }

  /** Mark other in-progress checkout orders failed and release their holds. */
  async supersedeOtherPendingCheckoutOrders(userId, keepOrderPublicId) {
    const since = new Date(Date.now() - config.pendingOrderTtlMinutes * 60 * 1000);
    const stale = await prisma.order.findMany({
      where: {
        userId,
        paymentStatus: 'UNPAID',
        status: 'PENDING',
        publicId: { not: keepOrderPublicId },
        createdAt: { gte: since },
        stripePaymentIntentId: { not: null },
      },
      select: { publicId: true },
    });

    for (const row of stale) {
      await this.releasePendingOrderResources(row.publicId).catch((err) => {
        console.error('[order] supersede release failed', row.publicId, err);
      });
      await prisma.order.updateMany({
        where: { publicId: row.publicId, paymentStatus: 'UNPAID' },
        data: { paymentStatus: 'FAILED', status: 'CANCELLED' },
      });
    }
  }

  /**
   * One pending order per checkout fingerprint — avoids duplicate UNPAID rows when the client
   * re-fetches payment intents (React strict mode, address edits, step navigation).
   */
  async resolvePendingOrderForCheckout(userPublicId, items, opts = {}) {
    const user = await prisma.user.findUnique({
      where: { publicId: userPublicId },
      select: { id: true },
    });
    if (!user) {
      throw new AppError(401, 'Unauthorized');
    }

    const signature = this.checkoutSignature(items, opts);

    if (opts.orderPublicId) {
      const byId = await prisma.order.findFirst({
        where: {
          publicId: opts.orderPublicId,
          userId: user.id,
          paymentStatus: 'UNPAID',
          status: 'PENDING',
        },
        include: {
          orderItems: {
            include: {
              product: { select: { publicId: true } },
              productVariant: { select: { publicId: true } },
            },
          },
        },
      });
      if (byId && buildCheckoutSignatureFromOrder(byId, byId.orderItems) === signature) {
        await this.supersedeOtherPendingCheckoutOrders(user.id, byId.publicId);
        return byId;
      }
    }

    const reusable = await this.findReusablePendingCheckoutOrder(user.id, signature);
    if (reusable) {
      await this.supersedeOtherPendingCheckoutOrders(user.id, reusable.publicId);
      return reusable;
    }

    const order = await this.createPendingOrderForStripe(userPublicId, items, opts);
    await this.supersedeOtherPendingCheckoutOrders(user.id, order.publicId);
    return order;
  }

  /**
   * Unpaid order for Stripe Checkout — stock validated but not decremented until webhook payment success.
   */
  async createPendingOrderForStripe(userPublicId, items, opts = {}) {
    await ensureOrderCheckoutColumns();

    const user = await prisma.user.findUnique({
      where: { publicId: userPublicId },
      select: { id: true, accessMemberUntil: true },
    });
    if (!user) {
      throw new AppError(401, 'Unauthorized');
    }

    const now = new Date();
    const hasAccess = Boolean(user.accessMemberUntil && user.accessMemberUntil > now);

    let subtotal = 0;
    const lineCreates = [];

    const order = await prisma.$transaction(async (tx) => {
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
          if (variantAvailableStock(v) < item.quantity) {
            throw new AppError(400, `Insufficient stock for "${product.name}"`);
          }
          variant = v;
          variantDbId = v.id;
        } else {
          assertStockAvailable(product, item.quantity);
        }

        const linePricing = buildOrderLinePricing(product, variant, hasAccess);
        subtotal += linePricing.price * item.quantity;
        lineCreates.push({
          productId: product.id,
          productVariantId: variantDbId,
          quantity: item.quantity,
          price: linePricing.price,
          retailUnitPrice: linePricing.retailUnitPrice,
          memberPriceSnapshot: linePricing.memberPriceSnapshot,
          pricingTier: linePricing.pricingTier,
        });

        await reserveOrderLineStock(tx, product, variantDbId, item.quantity, {
          referenceType: 'order',
          referenceId: `pending:${user.id}`,
          actorUserId: user.id,
        });
      }

      const created = await tx.order.create({
        data: {
          userId: user.id,
          orderNumber: placeholderOrderNumber(),
          totalAmount: subtotal,
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
      await assignOrderNumber(tx, created.id);
      return tx.order.findUnique({
        where: { id: created.id },
        include: { orderItems: { include: { product: true } } },
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
      console.error('[order] checkout shipping rates failed', order.publicId, error?.message || error);
      await this.releasePendingOrderResources(order.publicId).catch((releaseErr) => {
        console.error('[order] failed to release resources after shipping error', releaseErr);
      });
      if (!(error instanceof AppError)) {
        throw new AppError(502, 'Unable to calculate shipping for checkout', 'SHIPPING_RATE_FAILED');
      }
      throw error;
    }

    let totalAmount = subtotal + shippingCost;
    await prisma.order.update({
      where: { id: order.id },
      data: {
        shippingCost,
        shippingCarrier: selectedRate?.provider || null,
        totalAmount,
        ...selectedRateUpdateData(selectedRate, shipmentId),
      },
    });
    order.shippingCost = shippingCost;
    order.totalAmount = totalAmount;

    if (opts.storeCreditToApply && Number(opts.storeCreditToApply) > 0) {
      try {
        const held = await walletService.holdCredit(user.id, opts.storeCreditToApply, order.publicId);
        if (held > 0) {
          totalAmount = Math.max(0, totalAmount - held);
          await prisma.order.update({
            where: { id: order.id },
            data: { totalAmount, storeCreditApplied: held },
          });
          order.totalAmount = totalAmount;
          order.storeCreditApplied = held;
        }
      } catch (error) {
        await this.releasePendingOrderResources(order.publicId).catch((releaseErr) => {
          console.error('[order] failed to release resources after credit hold error', releaseErr);
        });
        throw error;
      }
    }

    return order;
  }

  /**
   * Release reserved stock (and optionally store-credit hold) for unpaid orders.
   * @param {string} orderPublicId
   * @param {{ itemPublicIds?: string[] | null, releaseStoreCredit?: boolean }} [opts]
   */
  async releasePendingOrderResources(orderPublicId, opts = {}) {
    const filterIds = Array.isArray(opts.itemPublicIds)
      ? new Set(opts.itemPublicIds.map(String))
      : null;
    const releaseStoreCredit = opts.releaseStoreCredit !== false;

    await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { publicId: orderPublicId },
        include: { orderItems: true },
      });
      if (!order || order.paymentStatus === 'PAID' || order.paymentStatus === 'PARTIALLY_REFUNDED') {
        return;
      }

      for (const line of order.orderItems) {
        if (line.cancelledAt) continue;
        if (filterIds && !filterIds.has(String(line.publicId))) continue;
        const product = await tx.product.findUnique({
          where: { id: line.productId },
          include: { variants: { orderBy: { sortOrder: 'asc' } } },
        });
        if (!product) continue;
        await releaseOrderLineStock(tx, product, line.productVariantId, line.quantity, {
          referenceType: 'order',
          referenceId: orderPublicId,
          actorUserId: order.userId,
        });
      }

      if (releaseStoreCredit && order.storeCreditApplied > 0 && !filterIds) {
        await walletService.releaseHoldInTx(
          tx,
          order.userId,
          order.storeCreditApplied,
          orderPublicId
        );
        await tx.order.update({
          where: { id: order.id },
          data: { storeCreditApplied: 0 },
        });
      }
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
        if (line.cancelledAt) continue;
        const product = await tx.product.findUnique({
          where: { id: line.productId },
          include: { variants: { orderBy: { sortOrder: 'asc' } } },
        });
        await commitOrderLineStock(tx, product, line.productVariantId, line.quantity, {
          referenceType: 'order',
          referenceId: orderPublicId,
          actorUserId: order.userId,
        });
      }

      if (order.storeCreditApplied > 0) {
        await walletService.captureHoldInTx(
          tx,
          order.userId,
          order.storeCreditApplied,
          orderPublicId
        );
      }

      const paid = await tx.order.update({
        where: { id: order.id },
        data: { paymentStatus: 'PAID', status: 'PROCESSING', fulfillmentStatus: 'NEW_ORDER' },
        include: { orderItems: true },
      });
      const { createUnitsForPaidOrder } = await import('./product-unit.service.js');
      await createUnitsForPaidOrder(tx, paid, paid.orderItems);
      return tx.order.findUnique({
        where: { id: order.id },
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
      fulfillmentStatus,
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
      and.push({
        OR: [
          { accessMembershipIncluded: true },
          { orderItems: { some: { pricingTier: 'ACCESS' } } },
          {
            user: {
              isGuest: false,
              accessMemberUntil: { gt: new Date() },
            },
          },
        ],
      });
    } else if (mf === 'guest') {
      and.push({ user: { isGuest: true } });
    } else if (mf === 'standard') {
      and.push({
        accessMembershipIncluded: false,
        NOT: { orderItems: { some: { pricingTier: 'ACCESS' } } },
        user: {
          isGuest: false,
          OR: [{ accessMemberUntil: null }, { accessMemberUntil: { lte: new Date() } }],
        },
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
          { orderNumber: { contains: q, mode: 'insensitive' } },
          { user: { email: { contains: q, mode: 'insensitive' } } },
          { user: { firstName: { contains: q, mode: 'insensitive' } } },
          { user: { lastName: { contains: q, mode: 'insensitive' } } },
        ],
      });
    }
    const fs = fulfillmentStatus && String(fulfillmentStatus).trim();
    if (fs) {
      and.push({ fulfillmentStatus: fs });
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
            isGuest: true,
          },
        },
        orderItems: {
          include: orderItemAdminInclude,
        },
        trackingEvents: { orderBy: { createdAt: 'desc' }, take: 80 },
      },
    });
    if (!order) {
      throw new AppError(404, 'Order not found');
    }
    return order;
  }

  async refundOrder(orderPublicId, actor, opts = {}) {
    const order = await prisma.order.findUnique({ where: { publicId: orderPublicId } });
    if (!order) throw new AppError(404, 'Order not found');
    if (order.paymentStatus !== 'PAID') {
      throw new AppError(400, 'Only paid orders can be refunded');
    }
    if (order.status === 'REFUNDED' || order.paymentStatus === 'REFUNDED') {
      throw new AppError(400, 'Order already refunded');
    }

    const { getStripe } = await import('./payment.service.js');
    const stripe = getStripe();
    if (!stripe) {
      throw new AppError(503, 'Stripe is not configured', 'STRIPE_NOT_CONFIGURED');
    }

    let paymentIntentId = order.stripePaymentIntentId;
    if (!paymentIntentId && order.stripeCheckoutSessionId) {
      const ref = order.stripeCheckoutSessionId;
      if (ref.startsWith('pi_')) {
        paymentIntentId = ref;
      } else if (ref.startsWith('cs_')) {
        const session = await stripe.checkout.sessions.retrieve(ref);
        paymentIntentId =
          typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
      }
    }
    if (!paymentIntentId) {
      throw new AppError(400, 'No Stripe payment reference found for this order', 'NO_PAYMENT_REFERENCE');
    }

    const refundAmountUsd = opts.amount != null ? Number(opts.amount) : Number(order.totalAmount);
    const amountCents = Math.round(refundAmountUsd * 100);
    if (amountCents < 1) {
      throw new AppError(400, 'Refund amount must be greater than zero');
    }

    const refund = await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        amount: amountCents,
        metadata: { orderPublicId, actorEmail: actor?.email || '' },
      },
      { idempotencyKey: `refund-${orderPublicId}-${amountCents}` }
    );

    const updated = await prisma.$transaction(async (tx) => {
      const withItems = await tx.order.findUnique({
        where: { id: order.id },
        include: { orderItems: true },
      });
      const { restockPaidOrderInTx } = await import('./inventory-restock.service.js');
      await restockPaidOrderInTx(tx, withItems, {
        referenceType: 'order',
        referenceId: orderPublicId,
        eventType: 'REFUND_RESTORE',
        note: 'Stripe refund',
        actorUserId: actor?.id ?? null,
      });
      return tx.order.update({
        where: { id: order.id },
        data: { status: 'REFUNDED', paymentStatus: 'REFUNDED' },
        include: { orderItems: { include: { product: true } }, user: userForOrderList },
      });
    });
    await writeAdminAudit({
      actorId: actor?.id,
      actorEmail: actor?.email,
      action: 'ORDER_REFUND',
      entityType: 'Order',
      entityId: orderPublicId,
      meta: {
        totalAmount: order.totalAmount,
        shippingCost: order.shippingCost,
        stripeRefundId: refund.id,
        refundAmountUsd,
      },
    });

    try {
      const customer = updated.user;
      if (customer?.email) {
        await emailService.sendTemplate({
          to: customer.email,
          template: 'refund-confirmation',
          context: {
            name: [customer.firstName, customer.lastName].filter(Boolean).join(' '),
            orderId: order.orderNumber || orderPublicId,
            amount: `$${refundAmountUsd.toFixed(2)}`,
            actionUrl: `${config.frontend.customerUrl}/dashboard/orders/${orderPublicId}`,
          },
        });
      }
    } catch (emailErr) {
      console.error('[order] refund confirmation email failed', orderPublicId, emailErr);
    }

    return updated;
  }

  async updateAdminShipping(orderPublicId, payload, actor) {
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
    if (payload.manualShippingNotes !== undefined) {
      data.manualShippingNotes = payload.manualShippingNotes
        ? String(payload.manualShippingNotes).trim()
        : null;
    }
    const shouldShip =
      data.trackingNumber &&
      ['PENDING', 'PROCESSING', 'CONFIRMED'].includes(order.status);
    if (shouldShip) {
      data.status = 'SHIPPED';
      data.fulfillmentStatus = 'SHIPPED';
      data.outboundShippedAt = new Date();
    }
    const updated = await prisma.order.update({
      where: { id: order.id },
      data,
      include: { orderItems: { include: { product: true } }, user: userForOrderList },
    });
    await writeAdminAudit({
      actorId: actor?.id,
      actorEmail: actor?.email,
      action: 'ORDER_SHIPPING_UPDATED',
      entityType: 'Order',
      entityId: orderPublicId,
      meta: {
        trackingNumber: updated.trackingNumber,
        shippingCarrier: updated.shippingCarrier,
        statusChanged: shouldShip,
      },
    });
    if (shouldShip) {
      await writeAdminAudit({
        actorId: actor?.id,
        actorEmail: actor?.email,
        action: 'FULFILLMENT_mark_shipped',
        entityType: 'Order',
        entityId: orderPublicId,
        meta: { from: order.fulfillmentStatus, to: 'SHIPPED', via: 'manual_shipping' },
      });
    }
    return updated;
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
      surface: 'admin',
      providerSlug: payload.providerSlug,
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
      surface: 'admin',
      providerSlug: payload.providerSlug,
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

  async resolveRateIdForOrder(order, payload = {}) {
    if (payload.rateId) return String(payload.rateId).trim();
    if (order.selectedRateId) return String(order.selectedRateId).trim();

    const parcels = payload.parcels || (await buildParcelsForOrder(order));
    const options = await this.getAdminShippingOptions(order.publicId, { parcels });
    const rates = options.rates || [];
    if (!rates.length) {
      throw new AppError(422, 'No UPS rates available for this order. Check UPS account activation.', 'SHIPPING_NO_RATES');
    }
    const matchToken = order.selectedRateServiceToken
      ? rates.find((r) => r.serviceToken === order.selectedRateServiceToken)
      : null;
    const matchLevel = order.selectedRateServiceLevel
      ? rates.find((r) => String(r.serviceLevel || '').includes(order.selectedRateServiceLevel))
      : null;
    return (matchToken || matchLevel || rates[0]).rateId;
  }

  async sendOrderTrackingEmail(order, trackingNumber) {
    const user = order.user;
    if (!user?.email || !trackingNumber) return;
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'there';
    const actionUrl = `${config.frontend.customerUrl}/dashboard/orders/${order.publicId}`;
    try {
      await emailService.sendTemplate({
        to: user.email,
        template: 'order-tracking',
        context: {
          name,
          orderId: order.orderNumber || order.publicId,
          trackingNumber,
          carrier: order.shippingCarrier || 'UPS',
          actionUrl,
        },
      });
    } catch (err) {
      console.error('[order] tracking email failed', user.email, err);
    }
  }

  async generateAdminShippingLabel(orderPublicId, payload, actor) {
    const order = await prisma.order.findUnique({
      where: { publicId: orderPublicId },
      include: {
        orderItems: { include: { product: true, productVariant: true } },
        user: { select: { email: true, firstName: true, lastName: true } },
      },
    });
    if (!order) throw new AppError(404, 'Order not found');
    if (!order.shippingAddressJson) {
      throw new AppError(400, 'Order has no shipping address', 'SHIPPING_ADDRESS_MISSING');
    }

    const parcels = payload.parcels?.length ? payload.parcels : await buildParcelsForOrder(order);
    const rateId = await this.resolveRateIdForOrder(order, { ...payload, parcels });

    const labelPayload = {
      ...payload,
      rateId,
      shippingAddress: order.shippingAddressJson,
      fromAddress: shippingService.getConfiguredOriginAddress(),
      parcels,
    };
    const label = await shippingService.generateLabel(labelPayload);

    const packageDetailsJson = {
      parcels,
      ups: {
        trackingNumber: label.trackingNumber || null,
        transactionId: label.transactionId || null,
        shipmentId: payload?.shipmentId || order.shippingShipmentId || null,
        labelUrl: label.shippingLabelUrl || null,
        generatedAt: new Date().toISOString(),
        serviceCode: order.selectedRateServiceToken || null,
      },
    };

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        ...(label.trackingNumber ? { trackingNumber: label.trackingNumber } : {}),
        ...(label.shippingCarrier ? { shippingCarrier: label.shippingCarrier } : {}),
        ...(label.shippingLabelUrl ? { shippingLabelUrl: label.shippingLabelUrl } : {}),
        ...(label.transactionId ? { shippingTransactionId: label.transactionId } : {}),
        ...(payload?.shipmentId ? { shippingShipmentId: String(payload.shipmentId) } : {}),
        ...(payload?.selectedRate ? selectedRateUpdateData(payload.selectedRate, payload?.shipmentId || order.shippingShipmentId) : {}),
        fulfillmentStatus: 'PICKUP_READY',
        labelGeneratedAt: new Date(),
        packageDetailsJson,
        trackingStatus: 'LABEL_CREATED',
        trackingStatusDetails: 'UPS shipping label generated',
        trackingStatusDate: new Date(),
        ...(order.fulfillmentStatus === 'NEW_ORDER' || !order.fulfillmentAcceptedAt
          ? { fulfillmentAcceptedAt: new Date() }
          : {}),
      },
      include: { orderItems: { include: { product: true } }, user: userForOrderList },
    });

    if (label.trackingNumber) {
      await this.sendOrderTrackingEmail(updated, label.trackingNumber);
    }

    await writeAdminAudit({
      actorId: actor?.id,
      actorEmail: actor?.email,
      action: 'ORDER_LABEL_PURCHASED',
      entityType: 'Order',
      entityId: orderPublicId,
      meta: {
        rateId,
        labelFileType: payload?.labelFileType || 'PDF_4x6',
        trackingNumber: label.trackingNumber || null,
      },
    });
    return { order: updated, label };
  }

  /** One-click UPS label: order address + estimated parcel + checkout rate (or best UPS rate). */
  async generateAdminUpsLabel(orderPublicId, actor) {
    return this.generateAdminShippingLabel(orderPublicId, {}, actor);
  }

  async bulkGenerateAdminUpsLabels(orderPublicIds, actor) {
    const results = [];
    for (const pid of orderPublicIds) {
      try {
        const { order, label } = await this.generateAdminUpsLabel(pid, actor);
        results.push({
          id: pid,
          ok: true,
          trackingNumber: label.trackingNumber || order.trackingNumber,
          shippingLabelUrl: label.shippingLabelUrl || order.shippingLabelUrl,
        });
      } catch (e) {
        results.push({ id: pid, ok: false, error: e.message || String(e) });
      }
    }
    return { results };
  }

  async streamLabelsZip(res, orderPublicIds) {
    const orders = await prisma.order.findMany({
      where: { publicId: { in: orderPublicIds }, shippingLabelUrl: { not: null } },
      select: { publicId: true, shippingLabelUrl: true },
    });
    if (!orders.length) {
      throw new AppError(404, 'No orders with labels found');
    }

    const archiver = (await import('archiver')).default;
    const archive = archiver('zip', { zlib: { level: 9 } });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="shipping-labels-${Date.now()}.zip"`
    );
    archive.pipe(res);

    for (const o of orders) {
      const rel = String(o.shippingLabelUrl || '').replace(/^\/uploads\/shipping-labels\//, '');
      const abs = path.join(SHIPPING_LABELS_DIR, rel);
      if (fs.existsSync(abs)) {
        archive.file(abs, { name: `${o.publicId}-${path.basename(abs)}` });
      }
    }
    await archive.finalize();
  }

  async generateAdminReturnLabel(orderPublicId, payload, actor) {
    const order = await prisma.order.findUnique({ where: { publicId: orderPublicId } });
    if (!order) throw new AppError(404, 'Order not found');
    const labelPayload = {
      ...payload,
      fromAddress: order.shippingAddressJson || payload.fromAddress,
      toAddress: shippingService.getConfiguredOriginAddress(),
      parcels: payload.parcels,
    };
    const label = await shippingService.generateLabel(labelPayload);
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

  async addTracking(orderPublicId, tracking, actor) {
    const order = await prisma.order.findUnique({ where: { publicId: orderPublicId } });
    if (!order) throw new AppError(404, 'Order not found');
    const statusWillShip =
      order.status === 'PROCESSING' || order.status === 'CONFIRMED' || order.status === 'PENDING';
    const updated = await prisma.order.update({
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
        ...(statusWillShip ? { status: 'SHIPPED' } : {}),
      },
    });
    await writeAdminAudit({
      actorId: actor?.id,
      actorEmail: actor?.email,
      action: 'ORDER_TRACKING_ADDED',
      entityType: 'Order',
      entityId: orderPublicId,
      meta: {
        trackingNumber: updated.trackingNumber,
        shippingCarrier: updated.shippingCarrier,
        statusChanged: statusWillShip,
      },
    });
    return updated;
  }

  async resolveStripePaymentIntentId(order) {
    const { getStripe } = await import('./payment.service.js');
    const stripe = getStripe();
    if (!stripe) return { stripe: null, paymentIntentId: null };

    let paymentIntentId = order.stripePaymentIntentId;
    if (!paymentIntentId && order.stripeCheckoutSessionId) {
      const ref = order.stripeCheckoutSessionId;
      if (ref.startsWith('pi_')) {
        paymentIntentId = ref;
      } else if (ref.startsWith('cs_')) {
        const session = await stripe.checkout.sessions.retrieve(ref);
        paymentIntentId =
          typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
      }
    }
    return { stripe, paymentIntentId };
  }

  /**
   * Cancel an entire order or selected line items before warehouse processing.
   * @param {object} order
   * @param {{ reason?: string|null, actorUserId?: number|null, reviewStatus?: string, itemPublicIds?: string[]|null }} opts
   */
  async finalizeOrderCancellation(
    order,
    { reason = null, actorUserId = null, reviewStatus = 'NONE', itemPublicIds = null } = {}
  ) {
    const orderPublicId = order.publicId;
    const reasonTrimmed = reason?.trim() || null;
    const activeLines = (order.orderItems || []).filter((line) => !line.cancelledAt);
    if (activeLines.length === 0) {
      throw new AppError(400, 'All items on this order are already cancelled');
    }

    let linesToCancel = activeLines;
    if (Array.isArray(itemPublicIds) && itemPublicIds.length > 0) {
      const wanted = new Set(itemPublicIds.map(String));
      linesToCancel = activeLines.filter((line) => wanted.has(String(line.publicId)));
      if (linesToCancel.length === 0) {
        throw new AppError(400, 'No matching active items to cancel');
      }
      const unknown = [...wanted].filter((id) => !activeLines.some((l) => String(l.publicId) === id));
      if (unknown.length > 0) {
        throw new AppError(400, 'One or more selected items are not on this order or already cancelled');
      }
    }

    const cancellingAll = linesToCancel.length === activeLines.length;
    const isPaid =
      order.paymentStatus === 'PAID' || order.paymentStatus === 'PARTIALLY_REFUNDED';
    let stripeRefundId = null;
    let refundAmountUsd = 0;

    const merchandiseSubtotal = activeLines.reduce(
      (sum, line) => sum + Number(line.price) * Number(line.quantity),
      0
    );
    const cancelMerchandise = linesToCancel.reduce(
      (sum, line) => sum + Number(line.price) * Number(line.quantity),
      0
    );
    const storeCreditOnOrder = Math.max(0, Number(order.storeCreditApplied) || 0);
    const taxOnOrder = Math.max(0, Number(order.taxAmount) || 0);
    const creditShare =
      cancellingAll || merchandiseSubtotal <= 0
        ? storeCreditOnOrder
        : Math.round((storeCreditOnOrder * (cancelMerchandise / merchandiseSubtotal)) * 100) / 100;
    const taxShare =
      cancellingAll || merchandiseSubtotal <= 0
        ? taxOnOrder
        : Math.round((taxOnOrder * (cancelMerchandise / merchandiseSubtotal)) * 100) / 100;
    // Full cancel refunds the remaining card total (includes shipping). Partial refunds
    // cancelled merchandise + proportional tax, minus store-credit share for those lines.
    if (cancellingAll && isPaid) {
      refundAmountUsd = Math.max(0, Number(order.totalAmount));
    } else if (isPaid) {
      refundAmountUsd = Math.max(
        0,
        Math.round((cancelMerchandise + taxShare - creditShare) * 100) / 100
      );
    }

    if (isPaid && refundAmountUsd > 0) {
      const { stripe, paymentIntentId } = await this.resolveStripePaymentIntentId(order);
      if (!stripe) {
        throw new AppError(503, 'Stripe is not configured', 'STRIPE_NOT_CONFIGURED');
      }
      if (!paymentIntentId) {
        throw new AppError(400, 'No Stripe payment reference found for this order', 'NO_PAYMENT_REFERENCE');
      }

      const amountCents = Math.round(refundAmountUsd * 100);
      if (amountCents > 0) {
        const lineKey = linesToCancel
          .map((l) => l.publicId)
          .sort()
          .join(',');
        const refund = await stripe.refunds.create(
          {
            payment_intent: paymentIntentId,
            amount: amountCents,
            metadata: {
              orderPublicId,
              source: cancellingAll ? 'customer_cancel' : 'customer_cancel_partial',
              itemPublicIds: lineKey.slice(0, 450),
            },
          },
          {
            idempotencyKey: `cancel-${orderPublicId}-${cancellingAll ? 'full' : lineKey}-${amountCents}`.slice(
              0,
              255
            ),
          }
        );
        stripeRefundId = refund.id;
      }
    } else if (!isPaid) {
      await this.releasePendingOrderResources(orderPublicId, {
        itemPublicIds: cancellingAll ? null : linesToCancel.map((l) => l.publicId),
        releaseStoreCredit: false,
      });
    }

    const cancelIds = linesToCancel.map((l) => l.publicId);
    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const withItems = await tx.order.findUnique({
        where: { id: order.id },
        include: { orderItems: true, user: userForOrderList },
      });
      if (!withItems) throw new AppError(404, 'Order not found');

      if (isPaid) {
        const { restockPaidOrderInTx } = await import('./inventory-restock.service.js');
        await restockPaidOrderInTx(tx, withItems, {
          referenceType: 'order',
          referenceId: orderPublicId,
          eventType: 'REFUND_RESTORE',
          note: cancellingAll ? 'Customer order cancellation' : 'Customer partial item cancellation',
          actorUserId,
          itemPublicIds: cancelIds,
        });
        if (creditShare > 0) {
          await walletService.refundRedeemedCreditInTx(
            tx,
            withItems.userId,
            creditShare,
            orderPublicId
          );
        }
      } else if (creditShare > 0) {
        await walletService.releaseHoldInTx(tx, withItems.userId, creditShare, orderPublicId);
      }

      await tx.orderItem.updateMany({
        where: {
          orderId: order.id,
          publicId: { in: cancelIds },
          cancelledAt: null,
        },
        data: {
          cancelledAt: now,
          cancellationReason: reasonTrimmed,
        },
      });

      const remainingActive = await tx.orderItem.count({
        where: { orderId: order.id, cancelledAt: null },
      });

      const nextStoreCredit = Math.max(
        0,
        Math.round((storeCreditOnOrder - creditShare) * 100) / 100
      );
      const nextTax = Math.max(0, Math.round((taxOnOrder - taxShare) * 100) / 100);
      let nextTotal;
      if (cancellingAll) {
        nextTotal = 0;
      } else if (isPaid) {
        nextTotal = Math.max(
          0,
          Math.round((Number(order.totalAmount) - refundAmountUsd) * 100) / 100
        );
      } else {
        // Unpaid: drop cancelled merchandise/tax/credit from the amount still due.
        nextTotal = Math.max(
          0,
          Math.round((Number(order.totalAmount) - cancelMerchandise - taxShare + creditShare) * 100) /
            100
        );
      }

      return tx.order.update({
        where: { id: order.id },
        data: {
          status: remainingActive === 0 ? 'CANCELLED' : order.status,
          paymentStatus: isPaid
            ? remainingActive === 0
              ? 'REFUNDED'
              : 'PARTIALLY_REFUNDED'
            : order.paymentStatus,
          fulfillmentStatus: remainingActive === 0 ? null : order.fulfillmentStatus,
          storeCreditApplied: nextStoreCredit,
          taxAmount: nextTax,
          totalAmount: nextTotal,
          cancellationReviewStatus: reviewStatus,
          cancellationRequestedAt: now,
          cancellationRequestReason: reasonTrimmed,
          cancellationReviewNote: null,
        },
        include: {
          orderItems: { include: orderItemCustomerInclude },
          user: userForOrderList,
        },
      });
    });

    try {
      const customer = updated.user;
      if (customer?.email && cancellingAll) {
        const name = [customer.firstName, customer.lastName].filter(Boolean).join(' ');
        await emailService.sendTemplate({
          to: customer.email,
          template: 'order-cancelled',
          context: {
            name,
            orderId: order.orderNumber || orderPublicId,
            reason: isPaid
              ? 'A refund has been initiated and may take 5–10 business days to appear.'
              : null,
            actionUrl: `${config.frontend.customerUrl}/dashboard/orders/${orderPublicId}`,
          },
        });
      }
    } catch (emailErr) {
      console.error('[order] cancellation email failed', orderPublicId, emailErr);
    }

    return {
      order: updated,
      isPaid,
      refundAmountUsd,
      stripeRefundId,
      partial: !cancellingAll,
    };
  }

  async cancelOrderByUser(orderPublicId, userPublicId, opts = {}) {
    const reason = typeof opts === 'string' ? opts : opts?.reason;
    const itemIds = typeof opts === 'string' ? null : opts?.itemIds;

    const [order, user] = await Promise.all([
      prisma.order.findUnique({
        where: { publicId: orderPublicId },
        include: { orderItems: true, user: userForOrderList },
      }),
      prisma.user.findUnique({ where: { publicId: userPublicId }, select: { id: true } }),
    ]);
    if (!order) throw new AppError(404, 'Order not found');
    if (!user || order.userId !== user.id) throw new AppError(403, 'Unauthorized to cancel this order');
    if (order.status === 'CANCELLED') {
      return {
        order,
        isPaid: order.paymentStatus === 'PAID' || order.paymentStatus === 'REFUNDED',
        refundAmountUsd: 0,
        stripeRefundId: null,
        partial: false,
      };
    }
    if (!canCustomerCancelOrder(order)) {
      throw new AppError(400, customerCancelUnavailableReason(order));
    }

    return this.finalizeOrderCancellation(order, {
      reason,
      actorUserId: user.id,
      reviewStatus: 'NONE',
      itemPublicIds: Array.isArray(itemIds) && itemIds.length > 0 ? itemIds : null,
    });
  }

  /**
   * Guest self-service cancel: verify tracking token or order number + email,
   * then apply the same pre-shipment cancel rules as authenticated customers.
   */
  async cancelOrderByGuest(payload) {
    let orderNumber = payload.orderNumber ? String(payload.orderNumber).trim() : '';
    let email = payload.email ? String(payload.email).trim().toLowerCase() : '';

    if (payload.token) {
      const verified = verifyOrderTrackingToken(payload.token);
      orderNumber = verified.orderNumber;
      email = verified.email;
    }

    if (!orderNumber || !email) {
      throw new AppError(400, 'Order number and email are required');
    }

    let order = await prisma.order.findFirst({
      where: {
        OR: [{ orderNumber }, { publicId: orderNumber }],
        contactEmail: { equals: email, mode: 'insensitive' },
      },
      include: {
        orderItems: true,
        user: { select: { publicId: true, id: true } },
      },
    });
    if (!order) {
      order = await prisma.order.findFirst({
        where: {
          OR: [{ orderNumber }, { publicId: orderNumber }],
          user: { email: { equals: email, mode: 'insensitive' } },
        },
        include: {
          orderItems: true,
          user: { select: { publicId: true, id: true } },
        },
      });
    }
    if (!order?.user) {
      throw new AppError(404, 'Order not found for that email');
    }

    return this.cancelOrderByUser(order.publicId, order.user.publicId, {
      reason: payload.reason,
      itemIds: payload.itemIds,
    });
  }

  /** @deprecated Use cancelOrderByUser — kept as alias for route handler compatibility. */
  async requestCancellationByUser(orderPublicId, userPublicId, reason) {
    const result = await this.cancelOrderByUser(orderPublicId, userPublicId, { reason });
    return result.order;
  }

  async reviewCancellationOrder(orderPublicId, { decision, note }, actor) {
    const order = await prisma.order.findUnique({
      where: { publicId: orderPublicId },
      include: { orderItems: true, user: userForOrderList },
    });
    if (!order) throw new AppError(404, 'Order not found');
    if (order.cancellationReviewStatus !== 'PENDING') {
      throw new AppError(400, 'No pending cancellation request for this order');
    }
    if (decision === 'approve') {
      const { order: updated } = await this.finalizeOrderCancellation(order, {
        reason: order.cancellationRequestReason,
        actorUserId: actor?.id ?? null,
        reviewStatus: 'APPROVED',
      });
      await writeAdminAudit({
        actorId: actor?.id,
        actorEmail: actor?.email,
        action: 'CANCELLATION_APPROVED',
        entityType: 'Order',
        entityId: orderPublicId,
        meta: { note: note?.trim() || null },
      });
      if (note?.trim()) {
        return prisma.order.update({
          where: { id: order.id },
          data: { cancellationReviewNote: note.trim() },
          include: { orderItems: { include: { product: true } }, user: userForOrderList },
        });
      }
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

  async patchOrderFulfillment(orderPublicId, body, actor) {
    const order = await prisma.order.findUnique({ where: { publicId: orderPublicId } });
    if (!order) throw new AppError(404, 'Order not found');
    const action = String(body.action || '').trim();
    const data = {};
    if (action === 'accept') {
      if (order.paymentStatus !== 'PAID') {
        throw new AppError(400, 'Only paid orders can be accepted into fulfillment');
      }
      if (order.fulfillmentStatus && order.fulfillmentStatus !== 'NEW_ORDER') {
        throw new AppError(400, 'Order is not awaiting acceptance');
      }
      data.fulfillmentStatus = 'ACCEPTED';
      data.fulfillmentAcceptedAt = new Date();
    } else if (action === 'pickup_ready') {
      data.fulfillmentStatus = 'PICKUP_READY';
      data.pickupReadyAt = new Date();
    } else if (action === 'mark_shipped') {
      data.fulfillmentStatus = 'SHIPPED';
      data.outboundShippedAt = new Date();
      if (['PENDING', 'PROCESSING', 'CONFIRMED'].includes(order.status)) data.status = 'SHIPPED';
    } else if (action === 'mark_delivered') {
      data.fulfillmentStatus = 'DELIVERED';
      data.deliveredAt = new Date();
      data.status = 'DELIVERED';
    } else if (action === 'reject_unpaid') {
      if (order.paymentStatus !== 'UNPAID') {
        throw new AppError(400, 'Only unpaid orders can be rejected from this action');
      }
      data.status = 'CANCELLED';
      data.fulfillmentStatus = null;
    } else {
      throw new AppError(400, 'Invalid fulfillment action', 'FULFILLMENT_ACTION_INVALID');
    }
    const updated = await prisma.order.update({
      where: { id: order.id },
      data,
      include: { orderItems: { include: { product: true } }, user: userForOrderList },
    });
    await writeAdminAudit({
      actorId: actor?.id,
      actorEmail: actor?.email,
      action: `FULFILLMENT_${action}`,
      entityType: 'Order',
      entityId: orderPublicId,
      meta: { from: order.fulfillmentStatus, to: updated.fulfillmentStatus },
    });
    return updated;
  }

  async pickOrderItem(orderPublicId, itemPublicId, body, actor) {
    const order = await prisma.order.findUnique({
      where: { publicId: orderPublicId },
      include: { orderItems: true },
    });
    if (!order) throw new AppError(404, 'Order not found');
    const line = order.orderItems.find((li) => li.publicId === itemPublicId);
    if (!line) throw new AppError(404, 'Order item not found');

    const pickedQuantity = Math.max(0, Math.min(Number(body.pickedQuantity ?? 0), line.quantity));
    const now = pickedQuantity > 0 ? new Date() : null;
    const pickerUserId = pickedQuantity > 0 ? await resolveActorUserId(actor) : null;

    await prisma.orderItem.update({
      where: { id: line.id },
      data: {
        pickedQuantity,
        pickedAt: pickedQuantity >= line.quantity ? now : pickedQuantity > 0 ? now : null,
        pickedByUserId: pickerUserId,
      },
    });

    let refreshed = await prisma.order.findUnique({
      where: { id: order.id },
      include: {
        orderItems: { include: orderItemAdminInclude },
        user: userForOrderList,
      },
    });

    const allPicked = refreshed.orderItems.every((li) => li.pickedQuantity >= li.quantity);
    if (
      allPicked &&
      refreshed.fulfillmentStatus === 'ACCEPTED' &&
      refreshed.paymentStatus === 'PAID'
    ) {
      const prevFulfillment = refreshed.fulfillmentStatus;
      refreshed = await prisma.order.update({
        where: { id: order.id },
        data: { fulfillmentStatus: 'PICKUP_READY', pickupReadyAt: new Date() },
        include: {
          orderItems: { include: orderItemAdminInclude },
          user: userForOrderList,
        },
      });
      await writeAdminAudit({
        actorId: actor?.id,
        actorEmail: actor?.email,
        action: 'FULFILLMENT_pickup_ready',
        entityType: 'Order',
        entityId: orderPublicId,
        meta: { from: prevFulfillment, to: 'PICKUP_READY', via: 'all_items_picked' },
      });
    }

    await writeAdminAudit({
      actorId: actor?.id,
      actorEmail: actor?.email,
      action: 'ORDER_ITEM_PICKED',
      entityType: 'OrderItem',
      entityId: itemPublicId,
      meta: { orderPublicId, pickedQuantity, quantity: line.quantity },
    });

    return refreshed;
  }

  async bulkPatchOrderFulfillment({ orderPublicIds, action }, actor) {
    const results = [];
    for (const pid of orderPublicIds) {
      try {
        const o = await this.patchOrderFulfillment(pid, { action }, actor);
        results.push({ id: pid, ok: true, order: o });
      } catch (e) {
        results.push({ id: pid, ok: false, error: e.message });
      }
    }
    return { results };
  }

  async createPickupList({ orderPublicIds, title }, actor) {
    const orders = await prisma.order.findMany({
      where: { publicId: { in: orderPublicIds } },
      include: {
        user: { select: { email: true, firstName: true, lastName: true, phone: true } },
        orderItems: {
          include: {
            product: true,
            productVariant: { select: { sku: true } },
          },
        },
      },
    });
    if (!orders.length) throw new AppError(400, 'No matching orders');
    const list = await prisma.pickupList.create({
      data: {
        title: title || `Pickup ${new Date().toISOString().slice(0, 10)}`,
        lines: {
          create: orders.map((o, i) => ({ orderId: o.id, sortOrder: i })),
        },
      },
      include: { lines: { include: { order: true } } },
    });
    await writeAdminAudit({
      actorId: actor?.id,
      actorEmail: actor?.email,
      action: 'PICKUP_LIST_CREATED',
      entityType: 'PickupList',
      entityId: list.publicId,
      meta: { count: orders.length },
    });
    return list;
  }

  async getPickupListForPdf(publicId) {
    const list = await prisma.pickupList.findUnique({
      where: { publicId },
      include: {
        lines: {
          orderBy: { sortOrder: 'asc' },
          include: {
            order: {
              include: {
                user: { select: { email: true, firstName: true, lastName: true, phone: true } },
                orderItems: { include: { product: true, productVariant: true } },
              },
            },
          },
        },
      },
    });
    if (!list) throw new AppError(404, 'Pickup list not found');
    return {
      title: list.title,
      orders: list.lines.map((l) => l.order),
    };
  }

  async getOrderPdfBuffer(orderPublicId, kind) {
    const order = await prisma.order.findUnique({
      where: { publicId: orderPublicId },
      include: {
        orderItems: { include: { product: true, productVariant: { select: { sku: true } } } },
        user: true,
      },
    });
    if (!order) throw new AppError(404, 'Order not found');
    if (kind === 'invoice') return orderDocuments.renderInvoicePdfBuffer(order);
    if (kind === 'packing') return orderDocuments.renderPackingSlipPdfBuffer(order);
    if (kind === 'summary') return orderDocuments.renderShippingSummaryPdfBuffer(order);
    if (kind === 'pick-list') {
      return orderDocuments.renderPickupListPdfBuffer({
        title: `Pick list — ${order.orderNumber || order.publicId}`,
        orders: [order],
      });
    }
    throw new AppError(400, 'Unknown PDF kind', 'PDF_KIND_INVALID');
  }

  async syncUpsTrackingBatch() {
    const orders = await prisma.order.findMany({
      where: {
        trackingNumber: { not: null },
        status: { notIn: ['DELIVERED', 'CANCELLED', 'RETURNED', 'REFUNDED'] },
      },
      take: 40,
    });
    let touched = 0;
    for (const order of orders) {
      try {
        const t = await shippingService.trackShipment(order.shippingCarrier || 'UPS', order.trackingNumber);
        const statusUp = String(t.status || '').toUpperCase();
        let fulfillment = order.fulfillmentStatus;
        if (statusUp.includes('DELIVERED')) fulfillment = 'DELIVERED';
        else if (statusUp.includes('OUT FOR')) fulfillment = 'OUT_FOR_DELIVERY';
        else if (
          statusUp.includes('TRANSIT') ||
          statusUp.includes('DEPART') ||
          statusUp.includes('ARRIVAL') ||
          statusUp.includes('SCAN')
        ) {
          fulfillment = 'IN_TRANSIT';
        }
        const statusChanged = String(t.status || '') !== String(order.trackingStatus || '');
        if (statusChanged) {
          await prisma.shipmentTrackingEvent.create({
            data: {
              orderId: order.id,
              source: 'ups',
              statusCode: String(t.status || '').slice(0, 120),
              description: t.statusDetails || null,
              raw: t.raw || t,
              eventAt: t.statusDate ? new Date(t.statusDate) : new Date(),
            },
          });
        }
        await prisma.order.update({
          where: { id: order.id },
          data: {
            trackingStatus: t.status || null,
            trackingStatusDetails: t.statusDetails || null,
            trackingStatusDate: t.statusDate ? new Date(t.statusDate) : new Date(),
            trackingEta: t.eta ? new Date(t.eta) : order.trackingEta,
            trackingHistoryJson: Array.isArray(t.history) ? t.history : [],
            ...(fulfillment ? { fulfillmentStatus: fulfillment } : {}),
            ...(fulfillment === 'DELIVERED' ? { status: 'DELIVERED', deliveredAt: new Date() } : {}),
          },
        });
        touched += 1;
      } catch {
        /* ignore */
      }
    }
    return { scanned: orders.length, touched };
  }

  /** Expire unpaid checkout orders and release reserved inventory / store credit holds. */
  async expireStalePendingOrders() {
    const ttlMs = config.pendingOrderTtlMinutes * 60 * 1000;
    const cutoff = new Date(Date.now() - ttlMs);
    const stale = await prisma.order.findMany({
      where: {
        paymentStatus: 'UNPAID',
        createdAt: { lt: cutoff },
      },
      select: { publicId: true },
      take: 50,
      orderBy: { createdAt: 'asc' },
    });

    for (const row of stale) {
      await this.releasePendingOrderResources(row.publicId).catch((err) => {
        console.error('[order] expire cleanup release failed', row.publicId, err);
      });
      await prisma.order.updateMany({
        where: { publicId: row.publicId, paymentStatus: 'UNPAID' },
        data: { paymentStatus: 'FAILED' },
      });
    }

    return stale.length;
  }
}

export const orderService = new OrderService();

export { computeAppliedUnitPrice, buildOrderLinePricing, resolveSelectedRate, selectedRateUpdateData };
