import Stripe from 'stripe';
import { prisma, refreshPrismaClientIfNeeded } from '../lib/prisma.js';
import { config } from '../config/env.js';
import { AppError } from '../utils/error-handler.js';
import { orderService } from './order.service.js';
import { checkoutIntentService } from './checkout-intent.service.js';
import { emailService } from './email.service.js';

async function getMembershipUnitAmountCents() {
  try {
    const row = await prisma.businessSettings.findUnique({ where: { id: 1 } });
    const usd = row?.accessMembershipPriceUsd ?? 50;
    return Math.round(Number(usd) * 100);
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && (e.code === 'P2021' || e.code === 'P2022')) {
      return Math.round(50 * 100);
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

export function getStripe() {
  if (!config.stripe.secretKey) return null;
  if (!stripeClient) {
    stripeClient = new Stripe(config.stripe.secretKey);
  }
  return stripeClient;
}

function hasValidConnectAccountId(value) {
  return typeof value === 'string' && /^acct_[A-Za-z0-9]+$/.test(value.trim());
}

function toStripeAppError(error, code, flow = 'order') {
  if (error instanceof AppError) return error;
  const stripeCode = error?.code ? String(error.code) : '';
  const stripeType = error?.type ? String(error.type) : '';
  const message = error?.message ? String(error.message) : 'Stripe request failed';
  console.error(`[payments] ${flow} stripe error`, { stripeCode, stripeType, message });
  return new AppError(502, message, code, {
    stripeCode: stripeCode || null,
    stripeType: stripeType || null,
    flow,
  });
}

async function ensureCheckoutPaymentIntent(stripe, checkoutIntent, user, opts = {}) {
  const refreshed = await prisma.checkoutIntent.findUnique({
    where: { id: checkoutIntent.id },
    select: { totalAmount: true, publicId: true, stripePaymentIntentId: true },
  });
  const payable = Number(refreshed?.totalAmount ?? checkoutIntent.totalAmount);
  const amountCents = Math.round(payable * 100);
  if (amountCents < 50) {
    throw new AppError(400, 'Order total is below the minimum charge amount', 'ORDER_TOTAL_TOO_LOW');
  }

  const checkoutIntentPublicId = refreshed?.publicId ?? checkoutIntent.publicId;
  const basePayload = {
    amount: amountCents,
    currency: 'usd',
    payment_method_types: ['card'],
    receipt_email: user.email || undefined,
    metadata: {
      flow: 'order',
      checkoutIntentPublicId,
    },
    ...(opts.saveCard ? { setup_future_usage: 'off_session' } : {}),
  };

  const reusableStatuses = new Set([
    'requires_payment_method',
    'requires_confirmation',
    'requires_action',
  ]);

  const existingId = refreshed?.stripePaymentIntentId;
  if (existingId) {
    let paymentIntent;
    try {
      paymentIntent = await stripe.paymentIntents.retrieve(existingId);
    } catch (retrieveErr) {
      console.warn('[payments] could not retrieve existing payment intent', existingId, retrieveErr?.message);
      paymentIntent = null;
    }

    if (paymentIntent?.status === 'succeeded') {
      throw new AppError(409, 'This checkout was already paid', 'ORDER_ALREADY_PAID');
    }

    if (
      paymentIntent &&
      paymentIntent.status !== 'canceled' &&
      reusableStatuses.has(paymentIntent.status)
    ) {
      if (paymentIntent.amount !== amountCents) {
        try {
          paymentIntent = await stripe.paymentIntents.update(existingId, { amount: amountCents });
        } catch (updateErr) {
          throw toStripeAppError(updateErr, 'STRIPE_PAYMENT_INTENT_FAILED', 'order');
        }
      }
      if (paymentIntent.client_secret) {
        return {
          clientSecret: paymentIntent.client_secret,
          checkoutIntentId: checkoutIntentPublicId,
          paymentIntentId: paymentIntent.id,
        };
      }
    }
  }

  let paymentIntent;
  try {
    paymentIntent = await createPaymentIntentWithOptionalTransfer(
      stripe,
      basePayload,
      config.stripe.connectStore
    );
  } catch (error) {
    throw toStripeAppError(error, 'STRIPE_PAYMENT_INTENT_FAILED', 'order');
  }

  await prisma.checkoutIntent.update({
    where: { id: checkoutIntent.id },
    data: { stripePaymentIntentId: paymentIntent.id },
  });

  if (!paymentIntent.client_secret) {
    throw new AppError(502, 'Stripe did not return a payment client secret', 'STRIPE_PAYMENT_INTENT_FAILED');
  }

  return {
    clientSecret: paymentIntent.client_secret,
    checkoutIntentId: checkoutIntentPublicId,
    paymentIntentId: paymentIntent.id,
  };
}

async function createPaymentIntentWithOptionalTransfer(stripe, basePayload, destinationAccount) {
  const hasDestination = hasValidConnectAccountId(destinationAccount);
  const payload = hasDestination
    ? {
        ...basePayload,
        transfer_data: { destination: destinationAccount.trim() },
      }
    : basePayload;

  try {
    return await stripe.paymentIntents.create(payload);
  } catch (error) {
    const stripeCode = error?.code ? String(error.code) : '';
    const rawMessage = error?.message ? String(error.message) : '';
    const lower = rawMessage.toLowerCase();
    const connectDestinationProblem =
      hasDestination &&
      (stripeCode === 'resource_missing' ||
        stripeCode === 'account_invalid' ||
        lower.includes('transfer_data[destination]') ||
        lower.includes('no such destination') ||
        lower.includes('connected account'));

    if (connectDestinationProblem) {
      console.warn('[payments] order payment intent fallback without transfer_data', {
        destinationAccount,
        stripeCode,
      });
      return stripe.paymentIntents.create(basePayload);
    }
    throw error;
  }
}

function getFlow(metadata) {
  return metadata && typeof metadata.flow === 'string' ? metadata.flow : null;
}

function getOrderPublicId(metadata) {
  return metadata && typeof metadata.orderPublicId === 'string' ? metadata.orderPublicId : null;
}

function getCheckoutIntentPublicId(metadata) {
  return metadata && typeof metadata.checkoutIntentPublicId === 'string'
    ? metadata.checkoutIntentPublicId
    : null;
}

async function markOrderFailedIfUnpaid(orderPublicId, source) {
  if (!orderPublicId) return { handled: true, source, error: 'missing orderPublicId' };
  await orderService.releasePendingOrderResources(orderPublicId).catch((err) => {
    console.error('[payments] release pending resources failed', orderPublicId, err);
  });
  await prisma.order.updateMany({
    where: { publicId: orderPublicId, paymentStatus: 'UNPAID' },
    data: { paymentStatus: 'FAILED' },
  });
  return { handled: true, flow: 'order', source, orderPublicId };
}

async function markOrderRefundedBySessionId(sessionId, source) {
  if (!sessionId || typeof sessionId !== 'string') {
    return { handled: true, source, error: 'missing sessionId' };
  }
  const order = await prisma.order.findFirst({
    where: { stripeCheckoutSessionId: sessionId, paymentStatus: { in: ['PAID', 'REFUNDED'] } },
    include: { orderItems: true },
  });
  if (!order) {
    return { handled: true, flow: 'order', source, sessionId, error: 'order not found' };
  }
  if (order.paymentStatus === 'PAID') {
    const { restockPaidOrderInTx } = await import('./inventory-restock.service.js');
    await prisma.$transaction(async (tx) => {
      await restockPaidOrderInTx(tx, order, {
        referenceType: 'order',
        referenceId: order.publicId,
        eventType: 'REFUND_RESTORE',
        note: `Stripe ${source}`,
      });
      await tx.order.update({
        where: { id: order.id },
        data: { paymentStatus: 'REFUNDED', status: 'REFUNDED' },
      });
    });
  } else {
    await prisma.order.updateMany({
      where: { id: order.id },
      data: { paymentStatus: 'REFUNDED', status: 'REFUNDED' },
    });
  }
  return { handled: true, flow: 'order', source, sessionId };
}

async function getCheckoutSessionIdFromPaymentIntent(stripe, paymentIntentId) {
  if (!paymentIntentId || typeof paymentIntentId !== 'string') return null;
  const sessions = await stripe.checkout.sessions.list({
    payment_intent: paymentIntentId,
    limit: 1,
  });
  return sessions?.data?.[0]?.id ?? null;
}

async function persistOrderPaymentIntent(orderPublicId, paymentIntentId) {
  if (!orderPublicId || !paymentIntentId) return;
  await prisma.order.updateMany({
    where: { publicId: orderPublicId },
    data: { stripePaymentIntentId: paymentIntentId },
  });
}

async function markCheckoutIntentFailed(checkoutIntentPublicId, source) {
  if (!checkoutIntentPublicId) {
    return { handled: true, source, error: 'missing checkoutIntentPublicId' };
  }
  await checkoutIntentService.releaseIntentResources(checkoutIntentPublicId).catch((err) => {
    console.error('[payments] release checkout intent failed', checkoutIntentPublicId, err);
  });
  await prisma.checkoutIntent.updateMany({
    where: { publicId: checkoutIntentPublicId, status: 'PENDING' },
    data: { status: 'FAILED' },
  });
  return { handled: true, flow: 'order', source, checkoutIntentPublicId };
}

async function markOrderFlowPaymentFailed(metadata, source) {
  const checkoutIntentPublicId = getCheckoutIntentPublicId(metadata);
  if (checkoutIntentPublicId) {
    return markCheckoutIntentFailed(checkoutIntentPublicId, source);
  }
  return markOrderFailedIfUnpaid(getOrderPublicId(metadata), source);
}

async function handleOrderCheckoutCompleted(session) {
  const checkoutIntentPublicId = getCheckoutIntentPublicId(session.metadata);
  const paymentIntentId =
    typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;

  if (checkoutIntentPublicId) {
    if (paymentIntentId) {
      await prisma.checkoutIntent.updateMany({
        where: { publicId: checkoutIntentPublicId },
        data: { stripePaymentIntentId: paymentIntentId },
      });
    }
    return handleCheckoutIntentPaymentCompleted(checkoutIntentPublicId);
  }

  const orderPublicId = getOrderPublicId(session.metadata);
  if (paymentIntentId) {
    await persistOrderPaymentIntent(orderPublicId, paymentIntentId);
  }
  return handleOrderPaymentCompleted(orderPublicId);
}

async function handleOrderPaymentIntentSucceeded(paymentIntent) {
  const flow = getFlow(paymentIntent.metadata);
  if (flow !== 'order') {
    return { handled: false, type: 'payment_intent.succeeded', flow };
  }
  const checkoutIntentPublicId = getCheckoutIntentPublicId(paymentIntent.metadata);
  if (checkoutIntentPublicId) {
    await prisma.checkoutIntent.updateMany({
      where: { publicId: checkoutIntentPublicId },
      data: { stripePaymentIntentId: paymentIntent.id },
    });
    return handleCheckoutIntentPaymentCompleted(checkoutIntentPublicId);
  }
  return handleOrderPaymentCompleted(getOrderPublicId(paymentIntent.metadata));
}

/** Card-only — excludes Klarna, Affirm, and other Pay Later methods on Checkout. */
function cardOnlyCheckoutOptions() {
  return { payment_method_types: ['card'] };
}

async function createCheckoutSessionWithOptionalTransfer(stripe, basePayload, destinationAccount, flow) {
  const hasDestination = hasValidConnectAccountId(destinationAccount);
  const payload = hasDestination
    ? {
        ...basePayload,
        ...cardOnlyCheckoutOptions(),
        payment_intent_data: {
          ...(basePayload.payment_intent_data || {}),
          transfer_data: { destination: destinationAccount.trim() },
        },
      }
    : { ...basePayload, ...cardOnlyCheckoutOptions() };

  try {
    return await stripe.checkout.sessions.create(payload);
  } catch (error) {
    const stripeCode = error?.code ? String(error.code) : '';
    const stripeType = error?.type ? String(error.type) : '';
    const rawMessage = error?.message ? String(error.message) : 'Stripe checkout session creation failed';
    const lower = rawMessage.toLowerCase();
    const connectDestinationProblem =
      hasDestination &&
      (stripeCode === 'resource_missing' ||
        stripeCode === 'account_invalid' ||
        lower.includes('transfer_data[destination]') ||
        lower.includes('no such destination') ||
        lower.includes('connected account'));

    if (connectDestinationProblem) {
      const fallbackPayload = { ...basePayload };
      const retrySession = await stripe.checkout.sessions.create(fallbackPayload);
      console.warn(`[payments] ${flow} checkout fallback without transfer_data`, {
        destinationAccount,
        stripeCode,
        stripeType,
      });
      return retrySession;
    }

    throw new AppError(502, rawMessage, 'STRIPE_CHECKOUT_CREATE_FAILED', {
      stripeCode: stripeCode || null,
      stripeType: stripeType || null,
      flow,
    });
  }
}

function assertConnectAccountsForOrder() {
  const stripe = getStripe();
  if (!stripe) {
    throw new AppError(503, 'Payments are not configured (missing STRIPE_SECRET_KEY)');
  }
  return stripe;
}

function assertConnectAccountsForMembership() {
  const stripe = getStripe();
  if (!stripe) {
    throw new AppError(503, 'Payments are not configured (missing STRIPE_SECRET_KEY)');
  }
  return stripe;
}

export async function createMembershipCheckoutSession(userPublicId, opts = {}) {
  const stripe = assertConnectAccountsForMembership();

  const { assertMembershipCheckoutAllowed } = await import('./membership-eligibility.service.js');
  const checkoutEligibility = await assertMembershipCheckoutAllowed(userPublicId, {
    intent: opts.intent,
    returnTo: opts.returnTo,
  });

  const user = await prisma.user.findUnique({
    where: { publicId: userPublicId },
    select: {
      email: true,
      publicId: true,
      babyName: true,
      membershipShippingAddressJson: true,
    },
  });
  if (!user) {
    throw new AppError(401, 'Unauthorized');
  }

  if (opts.registration) {
    const { saveMembershipRegistration } = await import('./membership.service.js');
    await saveMembershipRegistration(userPublicId, opts.registration);
  } else if (!user.babyName || !user.membershipShippingAddressJson) {
    throw new AppError(
      400,
      'Complete ACCESS registration (baby name and shipping address) before checkout.'
    );
  }

  const returnPath = normalizeStoreReturnPath(opts.returnTo);
  const successBase = `${config.storeUrl}/access/success?session_id={CHECKOUT_SESSION_ID}`;
  const successUrl = returnPath
    ? `${successBase}&returnTo=${encodeURIComponent(returnPath)}`
    : successBase;
  const cancelUrl = returnPath
    ? `${config.storeUrl}${returnPath}?access_cancelled=1`
    : `${config.storeUrl}/access?cancelled=1`;

  const unitCents = await getMembershipUnitAmountCents();

  const session = await createCheckoutSessionWithOptionalTransfer(
    stripe,
    {
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
    metadata: {
      flow: 'membership',
      userPublicId: user.publicId,
      checkoutIntent: checkoutEligibility.checkoutIntent || 'purchase',
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
    },
    config.stripe.connectMembership,
    'membership'
  );

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

  const checkoutIntent = await checkoutIntentService.resolveCheckoutIntent(userPublicId, items, {
    shippingAddress: opts.shippingAddress,
    billingAddress: opts.billingAddress,
    parcels: opts.parcels,
    selectedRateId: opts.selectedRateId,
    selectedRate: opts.selectedRate,
    storeCreditToApply: opts.storeCreditToApply,
    checkoutIntentPublicId: opts.orderId,
  });

  const successUrl = `${config.storeUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${config.storeUrl}/checkout/error?reason=cancelled`;

  const session = await createCheckoutSessionWithOptionalTransfer(
    stripe,
    {
    mode: 'payment',
    customer_email: user.email,
    customer_creation: 'always',
    line_items: checkoutIntent.lines.map((line) => ({
      quantity: line.quantity,
      price_data: {
        currency: 'usd',
        unit_amount: Math.round(Number(line.price) * 100),
        product_data: {
          name: line.product.name,
        },
      },
    })),
    metadata: {
      flow: 'order',
      checkoutIntentPublicId: checkoutIntent.publicId,
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
    },
    config.stripe.connectStore,
    'order'
  );

  await prisma.checkoutIntent.update({
    where: { id: checkoutIntent.id },
    data: { stripePaymentIntentId: session.id },
  });

  return { url: session.url, sessionId: session.id, checkoutIntentId: checkoutIntent.publicId };
}

async function sendOrderConfirmationEmail(orderPublicId) {
  const orderDetail = await prisma.order.findUnique({
    where: { publicId: orderPublicId },
    include: {
      orderItems: { include: { product: { select: { name: true } } } },
      user: { select: { email: true, firstName: true, lastName: true } },
    },
  });
  if (!orderDetail?.user?.email) return;

  const subtotal = orderDetail.orderItems.reduce(
    (sum, li) => sum + Number(li.price) * li.quantity,
    0
  );
  await emailService.sendTemplate({
    to: orderDetail.user.email,
    template: 'order-confirmation',
    context: {
      name: [orderDetail.user.firstName, orderDetail.user.lastName].filter(Boolean).join(' '),
      orderId: orderDetail.orderNumber || orderDetail.publicId,
      lines: orderDetail.orderItems.map((li) => ({
        name: li.product?.name || 'Item',
        qty: li.quantity,
        total: `$${(Number(li.price) * li.quantity).toFixed(2)}`,
      })),
      subtotal: `$${subtotal.toFixed(2)}`,
      shipping: `$${Number(orderDetail.shippingCost || 0).toFixed(2)}`,
      total: `$${Number(orderDetail.totalAmount).toFixed(2)}`,
      actionUrl: `${config.frontend.customerUrl}/dashboard/orders/${orderDetail.publicId}`,
    },
  });
}

async function handleCheckoutIntentPaymentCompleted(checkoutIntentPublicId) {
  if (!checkoutIntentPublicId) {
    return { handled: true, error: 'missing checkoutIntentPublicId' };
  }

  const intentBefore = await prisma.checkoutIntent.findUnique({
    where: { publicId: checkoutIntentPublicId },
    select: { status: true, orderPublicId: true },
  });
  if (!intentBefore) {
    return { handled: true, flow: 'order', error: 'missing checkout intent' };
  }
  const alreadyConsumed = intentBefore.status === 'CONSUMED' && intentBefore.orderPublicId;

  let paidOrder = null;
  try {
    paidOrder = await checkoutIntentService.createPaidOrderFromCheckoutIntent(checkoutIntentPublicId);
  } catch (err) {
    console.error('[stripe webhook] create order from checkout intent failed', checkoutIntentPublicId, err);
    await checkoutIntentService.releaseIntentResources(checkoutIntentPublicId).catch((releaseErr) => {
      console.error('[stripe webhook] release checkout intent failed', checkoutIntentPublicId, releaseErr);
    });
    await prisma.checkoutIntent.updateMany({
      where: { publicId: checkoutIntentPublicId, status: 'PENDING' },
      data: { status: 'FAILED' },
    });
    return { handled: true, flow: 'order', error: String(err?.message || err) };
  }

  if (!alreadyConsumed && paidOrder?.publicId) {
    try {
      await sendOrderConfirmationEmail(paidOrder.publicId);
    } catch (emailErr) {
      console.error('[stripe webhook] order confirmation email failed', paidOrder.publicId, emailErr);
    }
  }

  return { handled: true, flow: 'order', alreadyPaid: Boolean(alreadyConsumed) };
}

async function handleOrderPaymentCompleted(orderPublicId) {
  if (!orderPublicId) {
    return { handled: true, error: 'missing orderPublicId' };
  }
  const existingOrder = await prisma.order.findUnique({
    where: { publicId: orderPublicId },
    select: { paymentStatus: true },
  });
  if (!existingOrder) {
    return { handled: true, flow: 'order', error: 'missing order' };
  }
  const alreadyPaid = existingOrder.paymentStatus === 'PAID';

  let paidOrder = null;
  try {
    paidOrder = alreadyPaid
      ? await prisma.order.findUnique({
          where: { publicId: orderPublicId },
          select: { userId: true, publicId: true, orderNumber: true, totalAmount: true },
        })
      : await orderService.fulfillUnpaidOrderAfterPayment(orderPublicId);
  } catch (err) {
    console.error('[stripe webhook] fulfill order failed', orderPublicId, err);
    await orderService.releasePendingOrderResources(orderPublicId).catch((releaseErr) => {
      console.error('[stripe webhook] release pending resources failed', orderPublicId, releaseErr);
    });
    await prisma.order.updateMany({
      where: { publicId: orderPublicId, paymentStatus: 'UNPAID' },
      data: { paymentStatus: 'FAILED' },
    });
    return { handled: true, flow: 'order', error: String(err?.message || err) };
  }

  if (!alreadyPaid && paidOrder?.publicId) {
    try {
      await sendOrderConfirmationEmail(orderPublicId);
    } catch (emailErr) {
      console.error('[stripe webhook] order confirmation email failed', orderPublicId, emailErr);
    }
  }

  return { handled: true, flow: 'order', alreadyPaid };
}

export async function createOrderPaymentIntent(userPublicId, items, opts = {}) {
  refreshPrismaClientIfNeeded();
  const stripe = assertConnectAccountsForOrder();

  const user = await prisma.user.findUnique({
    where: { publicId: userPublicId },
    select: { email: true },
  });
  if (!user) {
    throw new AppError(401, 'Unauthorized');
  }

  const checkoutIntent = await checkoutIntentService.resolveCheckoutIntent(userPublicId, items, {
    shippingAddress: opts.shippingAddress,
    billingAddress: opts.billingAddress,
    parcels: opts.parcels,
    selectedRateId: opts.selectedRateId,
    selectedRate: opts.selectedRate,
    storeCreditToApply: opts.storeCreditToApply,
    checkoutIntentPublicId: opts.orderId,
  });

  return ensureCheckoutPaymentIntent(stripe, checkoutIntent, user, opts);
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

  const ref = String(sessionId).trim();
  const orderInclude = {
    orderItems: {
      include: {
        product: {
          select: {
            publicId: true,
            name: true,
            slug: true,
            imageUrl: true,
            price: true,
            compareAtPrice: true,
            memberPrice: true,
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
  };

  let order = await prisma.order.findFirst({
    where: {
      userId: user.id,
      OR: [{ stripeCheckoutSessionId: ref }, { stripePaymentIntentId: ref }],
    },
    include: orderInclude,
  });

  let session = null;
  if (!order) {
    try {
      session = await stripe.checkout.sessions.retrieve(ref, { expand: ['payment_intent'] });
    } catch {
      session = null;
    }

    const sessionIntentId = getCheckoutIntentPublicId(session?.metadata);
    if (sessionIntentId && (session?.payment_status === 'paid' || session?.status === 'complete')) {
      await handleCheckoutIntentPaymentCompleted(sessionIntentId);
      order = await prisma.order.findFirst({
        where: { userId: user.id, stripePaymentIntentId: ref },
        include: orderInclude,
      });
      if (!order) {
        const intent = await prisma.checkoutIntent.findUnique({
          where: { publicId: sessionIntentId },
          select: { orderPublicId: true },
        });
        if (intent?.orderPublicId) {
          order = await prisma.order.findUnique({
            where: { publicId: intent.orderPublicId, userId: user.id },
            include: orderInclude,
          });
        }
      }
    }

    const orderPublicId = session?.metadata?.orderPublicId;
    if (!order && orderPublicId) {
      order = await prisma.order.findUnique({
        where: { publicId: orderPublicId },
        include: orderInclude,
      });
      if (order?.paymentStatus === 'UNPAID') {
        await orderService.fulfillUnpaidOrderAfterPayment(orderPublicId);
        order = await prisma.order.findUnique({
          where: { publicId: orderPublicId },
          include: orderInclude,
        });
      }
    }
  }

  if (!order && ref.startsWith('pi_')) {
    try {
      const pi = await stripe.paymentIntents.retrieve(ref);
      const intentId = getCheckoutIntentPublicId(pi.metadata);
      if (intentId && pi.status === 'succeeded') {
        await handleCheckoutIntentPaymentCompleted(intentId);
        order = await prisma.order.findFirst({
          where: { userId: user.id, stripePaymentIntentId: ref },
          include: orderInclude,
        });
        if (!order) {
          const intent = await prisma.checkoutIntent.findUnique({
            where: { publicId: intentId },
            select: { orderPublicId: true },
          });
          if (intent?.orderPublicId) {
            order = await prisma.order.findUnique({
              where: { publicId: intent.orderPublicId, userId: user.id },
              include: orderInclude,
            });
          }
        }
      }
    } catch {
      /* fall through */
    }
  }

  if (!order || order.userId !== user.id) {
    throw new AppError(403, 'Unauthorized to access this checkout session');
  }

  const subtotal = order.orderItems.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0);
  let sessionAmountTotal = session && typeof session.amount_total === 'number' ? session.amount_total / 100 : null;
  let paymentMethodLabel = null;
  if (!sessionAmountTotal && ref.startsWith('pi_')) {
    try {
      const pi = await stripe.paymentIntents.retrieve(ref, { expand: ['payment_method'] });
      if (typeof pi.amount === 'number') sessionAmountTotal = pi.amount / 100;
      const pm = pi.payment_method;
      if (pm && typeof pm === 'object' && pm.card) {
        const brand = pm.card.brand ? String(pm.card.brand).replace(/^\w/, (c) => c.toUpperCase()) : 'Card';
        paymentMethodLabel = `${brand} ending ${pm.card.last4 || '····'}`;
      }
    } catch {
      sessionAmountTotal = null;
    }
  }
  const total = sessionAmountTotal ?? Number(order.totalAmount);

  const savingsToday = order.orderItems.reduce((sum, item) => {
    const paid = Number(item.price);
    const retail = Number(item.product?.compareAtPrice || item.product?.price || paid);
    const member = Number(item.product?.memberPrice || paid);
    const baseline = Math.max(retail, member);
    if (baseline > paid) return sum + (baseline - paid) * item.quantity;
    return sum;
  }, 0);

  return {
    sessionId: ref,
    order: {
      id: order.publicId,
      orderNumber: order.orderNumber,
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
      currency: (session?.currency || 'usd').toUpperCase(),
      subtotal,
      shipping: Number(order.shippingCost || 0),
      tax: 0,
      total: Math.max(total, subtotal + Number(order.shippingCost || 0)),
    },
    payment: {
      sessionStatus: session?.status || null,
      paymentStatus: session?.payment_status || order.paymentStatus,
      customerEmail: session?.customer_details?.email || order.user?.email || user.email,
      customerName:
        session?.customer_details?.name ||
        [order.user?.firstName, order.user?.lastName].filter(Boolean).join(' ') ||
        [user.firstName, user.lastName].filter(Boolean).join(' ') ||
        null,
      methodLabel: paymentMethodLabel,
    },
    savingsToday: Math.round(savingsToday * 100) / 100,
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

/** Thank-you page: confirm Stripe session and return ACCESS membership details. */
export async function getMembershipCheckoutSummary(userPublicId, sessionId) {
  const stripe = getStripe();
  if (!stripe) {
    throw new AppError(503, 'Payments are not configured (missing STRIPE_SECRET_KEY)');
  }
  const ref = String(sessionId || '').trim();
  if (!ref) {
    throw new AppError(400, 'session_id is required');
  }

  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(ref);
  } catch {
    throw new AppError(404, 'Checkout session not found');
  }

  if (getFlow(session.metadata) !== 'membership') {
    throw new AppError(400, 'Not an ACCESS membership checkout session');
  }
  if (session.metadata?.userPublicId !== userPublicId) {
    throw new AppError(403, 'Unauthorized to access this checkout session');
  }

  const paid =
    session.payment_status === 'paid' || session.payment_status === 'no_payment_required';
  if (!paid) {
    throw new AppError(402, 'Payment is not complete yet. Please wait a moment and refresh.');
  }

  const { completeMembershipPayment } = await import('./membership.service.js');
  await completeMembershipPayment(session);

  const user = await prisma.user.findUnique({
    where: { publicId: userPublicId },
    select: {
      email: true,
      firstName: true,
      lastName: true,
      babyName: true,
      accessNumber: true,
      accessMemberUntil: true,
    },
  });
  if (!user) {
    throw new AppError(401, 'Unauthorized');
  }

  const payment = await prisma.membershipPayment.findFirst({
    where: { stripeSessionId: ref },
    orderBy: { paidAt: 'desc' },
    select: { type: true, amount: true, accessValidUntil: true, paidAt: true },
  });

  const amountUsd =
    payment?.amount ??
    (typeof session.amount_total === 'number' ? session.amount_total / 100 : null);

  return {
    sessionId: ref,
    paymentType: payment?.type || 'PURCHASE',
    amount: amountUsd,
    accessNumber: user.accessNumber,
    validUntil: payment?.accessValidUntil || user.accessMemberUntil,
    customer: {
      email: session.customer_details?.email || user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      babyName: user.babyName,
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

  try {
    await prisma.stripeWebhookEvent.create({
      data: { eventId: event.id, type: event.type },
    });
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'P2002') {
      return { handled: true, duplicate: true, type: event.type };
    }
    if (error && typeof error === 'object' && (error.code === 'P2021' || error.code === 'P2022')) {
      console.warn('[stripe webhook] idempotency table missing — run prisma migrate deploy');
    } else {
      throw error;
    }
  }

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object;
    const flow = getFlow(session.metadata);
    if (flow === 'membership') {
      const { completeMembershipPayment } = await import('./membership.service.js');
      return completeMembershipPayment(session);
    }
    if (flow === 'order') {
      return handleOrderCheckoutCompleted(session);
    }
    return { handled: false, type: event.type, flow };
  }

  if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
    const session = event.data.object;
    const flow = getFlow(session.metadata);
    if (flow !== 'order') {
      return { handled: true, flow: flow || null, type: event.type };
    }
    return markOrderFlowPaymentFailed(session.metadata, event.type);
  }

  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object;
    return handleOrderPaymentIntentSucceeded(paymentIntent);
  }

  if (event.type === 'payment_intent.payment_failed') {
    const paymentIntent = event.data.object;
    const flow = getFlow(paymentIntent.metadata);
    if (flow === 'order') {
      return markOrderFlowPaymentFailed(paymentIntent.metadata, event.type);
    }
    const paymentIntentId = typeof paymentIntent.id === 'string' ? paymentIntent.id : null;
    const sessionId = await getCheckoutSessionIdFromPaymentIntent(stripe, paymentIntentId);
    if (!sessionId) {
      return { handled: true, type: event.type, error: 'checkout session not found' };
    }
    await prisma.order.updateMany({
      where: { stripeCheckoutSessionId: sessionId, paymentStatus: 'UNPAID' },
      data: { paymentStatus: 'FAILED' },
    });
    return { handled: true, flow: 'order', type: event.type, sessionId };
  }

  if (event.type === 'charge.refunded') {
    const charge = event.data.object;
    const paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : null;
    const sessionId = await getCheckoutSessionIdFromPaymentIntent(stripe, paymentIntentId);
    return markOrderRefundedBySessionId(sessionId, event.type);
  }

  return { handled: false, type: event.type };
}

export const supportedStripeWebhookEvents = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.expired',
  'checkout.session.async_payment_failed',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'charge.refunded',
];
