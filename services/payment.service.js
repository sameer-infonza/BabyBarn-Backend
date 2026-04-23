import Stripe from 'stripe';
import { PrismaClient } from '@prisma/client';
import { config } from '../config/env.js';
import { AppError } from '../utils/error-handler.js';
import { orderService } from './order.service.js';
import { emailService } from './email.service.js';

const prisma = new PrismaClient();

async function getMembershipUnitAmountCents() {
  try {
    const row = await prisma.businessSettings.findUnique({ where: { id: 1 } });
    const usd = row?.accessMembershipPriceUsd ?? 49;
    return Math.round(Number(usd) * 100);
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && (e.code === 'P2021' || e.code === 'P2022')) {
      return Math.round(49 * 100);
    }
    throw e;
  }
}

/** Same-origin path only (query/hash stripped). Used for post–ACCESS-checkout redirect. */
function normalizeStoreReturnPath(returnTo) {
  if (returnTo == null || typeof returnTo !== 'string') return null;
  const raw = returnTo.trim().split('#')[0].split('?')[0];
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  if (raw.includes('://') || raw.includes('..') || raw.includes('@')) return null;
  if (raw.length > 200) return null;
  return raw;
}

let stripeClient = null;

function getStripe() {
  if (!config.stripe.secretKey) return null;
  if (!stripeClient) {
    stripeClient = new Stripe(config.stripe.secretKey);
  }
  return stripeClient;
}

function assertConnectAccountsForOrder() {
  const stripe = getStripe();
  if (!stripe) {
    throw new AppError(503, 'Payments are not configured (missing STRIPE_SECRET_KEY)');
  }
  if (!config.stripe.connectStore) {
    throw new AppError(503, 'Store payouts are not configured (missing STRIPE_CONNECT_ACCOUNT_STORE)');
  }
  return stripe;
}

function assertConnectAccountsForMembership() {
  const stripe = getStripe();
  if (!stripe) {
    throw new AppError(503, 'Payments are not configured (missing STRIPE_SECRET_KEY)');
  }
  if (!config.stripe.connectMembership) {
    throw new AppError(
      503,
      'Membership payouts are not configured (missing STRIPE_CONNECT_ACCOUNT_MEMBERSHIP)'
    );
  }
  return stripe;
}

export async function createMembershipCheckoutSession(userPublicId, opts = {}) {
  const stripe = assertConnectAccountsForMembership();

  const user = await prisma.user.findUnique({
    where: { publicId: userPublicId },
    select: { email: true, publicId: true },
  });
  if (!user) {
    throw new AppError(401, 'Unauthorized');
  }

  const returnPath = normalizeStoreReturnPath(opts.returnTo);
  const successUrl = returnPath
    ? `${config.storeUrl}${returnPath}?access_success=1&session_id={CHECKOUT_SESSION_ID}`
    : `${config.storeUrl}/access?success=1&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = returnPath
    ? `${config.storeUrl}${returnPath}?access_cancelled=1`
    : `${config.storeUrl}/access?cancelled=1`;

  const unitCents = await getMembershipUnitAmountCents();

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: user.email,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: unitCents,
          product_data: {
            name: 'ACCESS Membership',
            description: 'Baby Barn ACCESS member benefits',
          },
        },
      },
    ],
    payment_intent_data: {
      transfer_data: {
        destination: config.stripe.connectMembership,
      },
    },
    metadata: {
      flow: 'membership',
      userPublicId: user.publicId,
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });

  return { url: session.url, sessionId: session.id };
}

export async function createOrderCheckoutSession(userPublicId, items, opts = {}) {
  const stripe = assertConnectAccountsForOrder();

  const user = await prisma.user.findUnique({
    where: { publicId: userPublicId },
    select: { email: true },
  });
  if (!user) {
    throw new AppError(401, 'Unauthorized');
  }

  const order = await orderService.createPendingOrderForStripe(userPublicId, items, {
    shippingAddress: opts.shippingAddress,
    billingAddress: opts.billingAddress,
    parcels: opts.parcels,
    selectedRateId: opts.selectedRateId,
    selectedRate: opts.selectedRate,
    storeCreditToApply: opts.storeCreditToApply,
  });

  const successUrl = `${config.storeUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${config.storeUrl}/checkout/error?reason=cancelled`;

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: user.email,
    customer_creation: 'always',
    line_items: order.orderItems.map((oi) => ({
      quantity: oi.quantity,
      price_data: {
        currency: 'usd',
        unit_amount: Math.round(Number(oi.price) * 100),
        product_data: {
          name: oi.product.name,
        },
      },
    })),
    payment_intent_data: {
      transfer_data: {
        destination: config.stripe.connectStore,
      },
    },
    metadata: {
      flow: 'order',
      orderPublicId: order.publicId,
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });

  await prisma.order.update({
    where: { id: order.id },
    data: { stripeCheckoutSessionId: session.id },
  });

  return { url: session.url, sessionId: session.id, orderId: order.publicId };
}

export async function getCheckoutSessionSummary(userPublicId, sessionId) {
  const stripe = getStripe();
  if (!stripe) {
    throw new AppError(503, 'Payments are not configured (missing STRIPE_SECRET_KEY)');
  }
  if (!sessionId || !String(sessionId).trim()) {
    throw new AppError(400, 'sessionId is required');
  }

  const user = await prisma.user.findUnique({
    where: { publicId: userPublicId },
    select: { id: true, publicId: true, email: true, firstName: true, lastName: true },
  });
  if (!user) {
    throw new AppError(401, 'Unauthorized');
  }

  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['payment_intent'],
  });
  const orderPublicId = session.metadata?.orderPublicId;
  if (!orderPublicId) {
    throw new AppError(404, 'Order not found for this checkout session');
  }

  const order = await prisma.order.findUnique({
    where: { publicId: orderPublicId },
    include: {
      orderItems: {
        include: {
          product: {
            select: {
              publicId: true,
              name: true,
              slug: true,
              imageUrl: true,
            },
          },
          productVariant: {
            select: {
              publicId: true,
              sku: true,
              imageUrl: true,
              combination: true,
            },
          },
        },
      },
      user: {
        select: {
          publicId: true,
          email: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  });

  if (!order || order.userId !== user.id) {
    throw new AppError(403, 'Unauthorized to access this checkout session');
  }

  const subtotal = order.orderItems.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0);
  const sessionAmountTotal = typeof session.amount_total === 'number' ? session.amount_total / 100 : null;
  const total = sessionAmountTotal ?? subtotal;

  return {
    sessionId: session.id,
    order: {
      id: order.publicId,
      status: order.status,
      paymentStatus: order.paymentStatus,
      createdAt: order.createdAt,
      products: order.orderItems.map((item) => ({
        id: item.id,
        quantity: item.quantity,
        unitPrice: Number(item.price),
        lineTotal: Number(item.price) * item.quantity,
        product: item.product,
        variant: item.productVariant
          ? {
              id: item.productVariant.publicId,
              sku: item.productVariant.sku,
              imageUrl: item.productVariant.imageUrl,
              combination: item.productVariant.combination,
            }
          : null,
      })),
    },
    pricing: {
      currency: (session.currency || 'usd').toUpperCase(),
      subtotal,
      shipping: Number(order.shippingCost || 0),
      tax: 0,
      total: Math.max(total, subtotal + Number(order.shippingCost || 0)),
    },
    payment: {
      sessionStatus: session.status,
      paymentStatus: session.payment_status,
      customerEmail: session.customer_details?.email || order.user?.email || user.email,
      customerName:
        session.customer_details?.name ||
        [order.user?.firstName, order.user?.lastName].filter(Boolean).join(' ') ||
        [user.firstName, user.lastName].filter(Boolean).join(' ') ||
        null,
    },
    customer: {
      id: user.publicId,
      email: order.user?.email || user.email,
      firstName: order.user?.firstName || user.firstName || null,
      lastName: order.user?.lastName || user.lastName || null,
    },
    shipping: {
      address: order.shippingAddressJson || null,
      carrier: order.shippingCarrier || null,
      trackingNumber: order.trackingNumber || null,
      labelUrl: order.shippingLabelUrl || null,
      selectedRate: {
        rateId: order.selectedRateId || null,
        provider: order.selectedRateProvider || null,
        serviceLevel: order.selectedRateServiceLevel || null,
        amount: order.selectedRateAmount ?? null,
        currency: order.selectedRateCurrency || null,
        estimatedDays: order.selectedRateEstimatedDays ?? null,
      },
      returnLabel: {
        labelUrl: order.returnLabelUrl || null,
        carrier: order.returnShippingCarrier || null,
        trackingNumber: order.returnTrackingNumber || null,
      },
      tracking: {
        status: order.trackingStatus || null,
        statusDetails: order.trackingStatusDetails || null,
        statusDate: order.trackingStatusDate || null,
        eta: order.trackingEta || null,
        history: order.trackingHistoryJson || [],
      },
    },
  };
}

export async function processStripeWebhook(rawBody, signatureHeader) {
  const stripe = getStripe();
  if (!stripe || !config.stripe.webhookSecret) {
    throw new Error('Webhook not configured');
  }

  const event = stripe.webhooks.constructEvent(
    rawBody,
    signatureHeader,
    config.stripe.webhookSecret
  );

  if (event.type !== 'checkout.session.completed') {
    return { handled: false, type: event.type };
  }

  const session = event.data.object;
  const flow = session.metadata?.flow;

  if (flow === 'membership') {
    const userPublicId = session.metadata?.userPublicId;
    if (!userPublicId) {
      return { handled: true, error: 'missing userPublicId' };
    }
    const days = parseInt(process.env.ACCESS_MEMBERSHIP_DAYS || '365', 10);
    const until = new Date();
    until.setUTCDate(until.getUTCDate() + days);

    await prisma.user.update({
      where: { publicId: userPublicId },
      data: {
        accessMemberUntil: until,
        ...(typeof session.customer === 'string' ? { stripeCustomerId: session.customer } : {}),
      },
    });
    return { handled: true, flow: 'membership' };
  }

  if (flow === 'order') {
    const orderPublicId = session.metadata?.orderPublicId;
    if (!orderPublicId) {
      return { handled: true, error: 'missing orderPublicId' };
    }
    try {
      const paidOrder = await orderService.fulfillUnpaidOrderAfterPayment(orderPublicId);
      const user = await prisma.user.findUnique({
        where: { id: paidOrder.userId },
        select: { email: true, firstName: true, lastName: true },
      });
      if (user?.email) {
        await emailService.sendTemplate({
          to: user.email,
          template: 'order-confirmation',
          context: {
            name: [user.firstName, user.lastName].filter(Boolean).join(' '),
            orderId: paidOrder.publicId,
            total: `$${Number(paidOrder.totalAmount).toFixed(2)}`,
            actionUrl: `${config.frontend.customerUrl}/dashboard/orders/${paidOrder.publicId}`,
          },
        });
      }
    } catch (err) {
      console.error('[stripe webhook] fulfill order failed', orderPublicId, err);
      await prisma.order.updateMany({
        where: { publicId: orderPublicId, paymentStatus: 'UNPAID' },
        data: { paymentStatus: 'FAILED' },
      });
      return { handled: true, flow: 'order', error: String(err?.message || err) };
    }
    return { handled: true, flow: 'order' };
  }

  return { handled: false };
}
