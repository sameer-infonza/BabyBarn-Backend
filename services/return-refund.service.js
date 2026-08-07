import { prisma } from '../lib/prisma.js';
import { AppError } from '../utils/error-handler.js';
import { writeAdminAudit } from './audit.service.js';
import { appendReturnActionNote } from './return-status-events.service.js';
import { emailService } from './email.service.js';
import { config } from '../config/env.js';

async function resolveActorUserId(actor) {
  if (!actor?.id) return null;
  const user = await prisma.user.findUnique({ where: { publicId: actor.id }, select: { id: true } });
  return user?.id ?? null;
}

function moneyRound(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

/** Product-value (pre-tax) for a standard return line. */
export function computeStandardReturnSubtotal(orderItem, quantity = 1) {
  const qty = Math.max(0, Number(quantity || 0));
  if (qty <= 0) return 0;
  const unit = Number(orderItem?.price ?? 0);
  return moneyRound(unit * qty);
}

/**
 * Order merchandise subtotal from line items (pre-tax, before store credit).
 * @param {{ price?: number, quantity?: number }[] | null | undefined} orderItems
 */
export function orderMerchandiseSubtotal(orderItems) {
  if (!Array.isArray(orderItems) || !orderItems.length) return 0;
  return moneyRound(
    orderItems.reduce(
      (sum, line) => sum + Number(line.price ?? 0) * Math.max(0, Number(line.quantity ?? 0)),
      0
    )
  );
}

/**
 * Proportional tax share for returned merchandise.
 * Shipping is never refunded on standard returns.
 */
export function computeReturnTaxShare(returnMerchandise, order) {
  const orderTax = Math.max(0, Number(order?.taxAmount ?? 0));
  if (orderTax <= 0 || returnMerchandise <= 0) return 0;
  const orderMerch = orderMerchandiseSubtotal(order?.orderItems);
  if (orderMerch <= 0) return 0;
  return moneyRound(orderTax * (returnMerchandise / orderMerch));
}

/** Product + proportional tax. Excludes shipping (non-refundable). */
export function computeStandardReturnRefundAmount(orderItem, quantity = 1, order = null) {
  const subtotal = computeStandardReturnSubtotal(orderItem, quantity);
  if (subtotal <= 0) return 0;
  const tax = order ? computeReturnTaxShare(subtotal, order) : 0;
  return moneyRound(subtotal + tax);
}

async function resolvePaymentIntentId(order) {
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
  return { stripe, paymentIntentId };
}

/**
 * Issue a partial Stripe refund for an approved standard return (product + proportional tax).
 * Shipping is never refunded. Idempotent when stripeRefundId is already set on the return.
 */
export async function processStandardReturnRefund(returnRequest, actor) {
  if (returnRequest.type !== 'STANDARD') {
    throw new AppError(400, 'Refunds apply to standard returns only');
  }
  if (returnRequest.stripeRefundId) {
    return {
      skipped: true,
      refundAmount: returnRequest.refundAmount,
      stripeRefundId: returnRequest.stripeRefundId,
    };
  }

  const full = await prisma.returnRequest.findUnique({
    where: { id: returnRequest.id },
    include: {
      orderItem: true,
      order: {
        select: {
          id: true,
          publicId: true,
          paymentStatus: true,
          stripePaymentIntentId: true,
          stripeCheckoutSessionId: true,
          taxAmount: true,
          orderItems: { select: { price: true, quantity: true } },
        },
      },
      user: { select: { email: true, firstName: true, lastName: true } },
    },
  });
  if (!full?.orderItem || !full.order) {
    throw new AppError(400, 'Return is missing order line data for refund');
  }
  if (full.order.paymentStatus !== 'PAID') {
    throw new AppError(400, 'Order is not in a refundable payment state');
  }

  const qty = full.acceptedQuantity != null ? full.acceptedQuantity : full.quantity;
  const refundAmountUsd = computeStandardReturnRefundAmount(full.orderItem, qty, full.order);
  if (refundAmountUsd <= 0) {
    throw new AppError(400, 'Refund amount must be greater than zero');
  }

  const amountCents = Math.round(refundAmountUsd * 100);
  const { stripe, paymentIntentId } = await resolvePaymentIntentId(full.order);

  const refund = await stripe.refunds.create(
    {
      payment_intent: paymentIntentId,
      amount: amountCents,
      metadata: {
        returnPublicId: full.publicId,
        orderPublicId: full.order.publicId,
        actorEmail: actor?.email || '',
        refundType: 'standard_return',
      },
    },
    { idempotencyKey: `return-refund-${full.publicId}-${amountCents}` }
  );

  let refundPaymentMethodLabel = null;
  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ['payment_method', 'latest_charge'],
    });
    const pm =
      typeof pi.payment_method === 'object' && pi.payment_method
        ? pi.payment_method
        : typeof pi.latest_charge === 'object' && pi.latest_charge?.payment_method_details
          ? null
          : null;
    const card =
      pm?.card ||
      (typeof pi.latest_charge === 'object' ? pi.latest_charge?.payment_method_details?.card : null);
    if (card?.brand || card?.last4) {
      const brand = card.brand ? String(card.brand).replace(/^\w/, (c) => c.toUpperCase()) : 'Card';
      refundPaymentMethodLabel = card.last4 ? `${brand} ····${card.last4}` : brand;
    }
  } catch {
    // Non-fatal — destination label is best-effort.
  }

  const updated = await prisma.returnRequest.update({
    where: { id: full.id },
    data: {
      refundAmount: refundAmountUsd,
      stripeRefundId: refund.id,
      refundedAt: new Date(),
      ...(refundPaymentMethodLabel ? { refundPaymentMethodLabel } : {}),
    },
  });

  await appendReturnActionNote(prisma, {
    returnRequestId: full.id,
    status: full.status,
    actorUserId: await resolveActorUserId(actor),
    note: `Refund processed · $${refundAmountUsd.toFixed(2)}`,
  });

  await writeAdminAudit({
    actorId: actor?.id,
    actorEmail: actor?.email,
    action: 'RETURN_REFUND',
    entityType: 'ReturnRequest',
    entityId: full.publicId,
    meta: { refundAmountUsd, stripeRefundId: refund.id },
  });

  if (full.user?.email) {
    await emailService.sendTemplate({
      to: full.user.email,
      template: 'refund-confirmation',
      context: {
        name: [full.user.firstName, full.user.lastName].filter(Boolean).join(' '),
        amount: `$${refundAmountUsd.toFixed(2)}`,
        orderId: full.order.publicId,
        actionUrl: `${config.frontend.customerUrl}/dashboard/returns/${full.publicId}`,
      },
    });
  }

  return {
    skipped: false,
    refundAmount: refundAmountUsd,
    stripeRefundId: refund.id,
    returnRequest: updated,
  };
}
