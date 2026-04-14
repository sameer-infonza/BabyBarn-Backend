import Stripe from 'stripe';
import { PrismaClient } from '@prisma/client';
import { config } from '../config/env.js';
import { AppError } from '../utils/error-handler.js';
import { orderService } from './order.service.js';

const prisma = new PrismaClient();

const MEMBERSHIP_UNIT_AMOUNT_CENTS = 5000;

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

export async function createMembershipCheckoutSession(userPublicId) {
  const stripe = assertConnectAccountsForMembership();

  const user = await prisma.user.findUnique({
    where: { publicId: userPublicId },
    select: { email: true, publicId: true },
  });
  if (!user) {
    throw new AppError(401, 'Unauthorized');
  }

  const successUrl = `${config.storeUrl}/access?success=1&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${config.storeUrl}/access?cancelled=1`;

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: user.email,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: MEMBERSHIP_UNIT_AMOUNT_CENTS,
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

export async function createOrderCheckoutSession(userPublicId, items) {
  const stripe = assertConnectAccountsForOrder();

  const user = await prisma.user.findUnique({
    where: { publicId: userPublicId },
    select: { email: true },
  });
  if (!user) {
    throw new AppError(401, 'Unauthorized');
  }

  const order = await orderService.createPendingOrderForStripe(userPublicId, items);

  const successUrl = `${config.storeUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${config.storeUrl}/checkout?cancelled=1`;

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
      await orderService.fulfillUnpaidOrderAfterPayment(orderPublicId);
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
