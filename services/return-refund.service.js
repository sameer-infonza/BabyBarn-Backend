import { prisma } from '../lib/prisma.js';
import { AppError } from '../utils/error-handler.js';
import { writeAdminAudit } from './audit.service.js';
import { appendReturnActionNote } from './return-status-events.service.js';
import { emailService } from './email.service.js';
import { config } from '../config/env.js';
import {
  assertRefundWithinRemaining,
  classifyStripeRefundError,
  derivePaymentStatusFromRefundTotals,
  extractStripeRefundBalance,
  fetchStripeRefundBalance,
  isRefundablePaymentStatus,
  localRemainingRefundableUsd,
  moneyRound,
  resolveRemainingRefundableCents,
  usdToCents,
} from '../lib/order-refund-balance.js';

async function resolveActorUserId(actor) {
  if (!actor?.id) return null;
  const user = await prisma.user.findUnique({ where: { publicId: actor.id }, select: { id: true } });
  return user?.id ?? null;
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
 * Prefer excluding cancelled lines so tax share matches remaining order tax after partial cancel.
 */
export function orderMerchandiseSubtotal(orderItems, { excludeCancelled = false } = {}) {
  if (!Array.isArray(orderItems) || !orderItems.length) return 0;
  const lines = excludeCancelled ? orderItems.filter((line) => !line.cancelledAt) : orderItems;
  if (!lines.length) return 0;
  return moneyRound(
    lines.reduce(
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
  const orderMerch = orderMerchandiseSubtotal(order?.orderItems, { excludeCancelled: true });
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

function idempotentResult(returnRequest, paymentStatus) {
  return {
    skipped: true,
    refundAmount: returnRequest.refundAmount,
    stripeRefundId: returnRequest.stripeRefundId,
    returnRequest,
    paymentStatus,
  };
}

function mapStripeRefundError(err) {
  const classified = classifyStripeRefundError(err);
  if (!classified) return null;
  return new AppError(400, classified.message, classified.code);
}

/**
 * Persist return refund + update order payment ledger inside a transaction.
 * Safe to retry when Stripe already succeeded (idempotent on return.stripeRefundId).
 */
async function persistReturnRefundAndOrderState({
  returnRequestId,
  orderId,
  refundAmountUsd,
  stripeRefundId,
  refundPaymentMethodLabel,
  amountPaidCents,
  amountRefundedCentsAfter,
  actor,
  returnPublicId,
  returnStatus,
}) {
  const actorUserId = await resolveActorUserId(actor);
  const requestedCents = usdToCents(refundAmountUsd);

  const result = await prisma.$transaction(async (tx) => {
    const lockedReturns = await tx.$queryRaw`
      SELECT id, "stripeRefundId", "refundAmount", "refundedAt"
      FROM "ReturnRequest"
      WHERE id = ${returnRequestId}
      FOR UPDATE
    `;
    const lockedReturn = lockedReturns?.[0];
    if (!lockedReturn) {
      throw new AppError(404, 'Return request not found');
    }
    if (lockedReturn.stripeRefundId) {
      const existing = await tx.returnRequest.findUnique({ where: { id: returnRequestId } });
      const orderRow = await tx.order.findUnique({
        where: { id: orderId },
        select: { paymentStatus: true },
      });
      return {
        skipped: true,
        refundAmount: existing?.refundAmount,
        stripeRefundId: existing?.stripeRefundId,
        returnRequest: existing,
        paymentStatus: orderRow?.paymentStatus,
      };
    }

    const lockedOrders = await tx.$queryRaw`
      SELECT id, "totalAmount", "paymentStatus"
      FROM "Order"
      WHERE id = ${orderId}
      FOR UPDATE
    `;
    const lockedOrder = lockedOrders?.[0];
    if (!lockedOrder) {
      throw new AppError(404, 'Order not found');
    }

    // Local ledger re-check under lock (cancel + other return refunds reduce totalAmount).
    const localRemainingCents = usdToCents(localRemainingRefundableUsd(lockedOrder));
    const withinLocal = assertRefundWithinRemaining(requestedCents, localRemainingCents);
    if (!withinLocal.ok) {
      throw new AppError(400, withinLocal.message, withinLocal.code);
    }

    if (!isRefundablePaymentStatus(lockedOrder.paymentStatus)) {
      throw new AppError(
        400,
        'Order is not in a refundable payment state',
        'ORDER_NOT_REFUNDABLE'
      );
    }

    const nextTotal = moneyRound(
      Math.max(0, Number(lockedOrder.totalAmount) - Number(refundAmountUsd))
    );
    const paymentStatus = derivePaymentStatusFromRefundTotals(
      amountPaidCents,
      amountRefundedCentsAfter
    );

    const updated = await tx.returnRequest.update({
      where: { id: returnRequestId },
      data: {
        refundAmount: refundAmountUsd,
        stripeRefundId,
        refundedAt: new Date(),
        ...(refundPaymentMethodLabel ? { refundPaymentMethodLabel } : {}),
      },
    });

    await tx.order.update({
      where: { id: orderId },
      data: {
        totalAmount: nextTotal,
        paymentStatus,
      },
    });

    await appendReturnActionNote(tx, {
      returnRequestId,
      status: returnStatus,
      actorUserId,
      note: `Refund processed · $${Number(refundAmountUsd).toFixed(2)} · order payment ${paymentStatus}`,
    });

    return {
      skipped: false,
      refundAmount: refundAmountUsd,
      stripeRefundId,
      returnRequest: updated,
      paymentStatus,
      orderTotalAmount: nextTotal,
    };
  });

  if (!result.skipped) {
    await writeAdminAudit({
      actorId: actor?.id,
      actorEmail: actor?.email,
      action: 'RETURN_REFUND',
      entityType: 'ReturnRequest',
      entityId: returnPublicId,
      meta: {
        refundAmountUsd,
        stripeRefundId,
        orderId,
        paymentStatus: result.paymentStatus,
        orderTotalAmount: result.orderTotalAmount,
        amountPaidCents,
        amountRefundedCentsAfter,
      },
    });
  }

  return result;
}

/**
 * Issue a partial Stripe refund for an approved standard return (product + proportional tax).
 * Shipping is never refunded. Idempotent when stripeRefundId is already set on the return.
 *
 * Remaining refundable amount is enforced from Stripe + local order.totalAmount (not status alone).
 */
export async function processStandardReturnRefund(returnRequest, actor) {
  if (returnRequest.type !== 'STANDARD') {
    throw new AppError(400, 'Refunds apply to standard returns only');
  }
  if (returnRequest.stripeRefundId) {
    return idempotentResult(returnRequest);
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
          totalAmount: true,
          taxAmount: true,
          stripePaymentIntentId: true,
          stripeCheckoutSessionId: true,
          orderItems: { select: { price: true, quantity: true, cancelledAt: true } },
        },
      },
      user: { select: { email: true, firstName: true, lastName: true } },
    },
  });
  if (!full?.orderItem || !full.order) {
    throw new AppError(400, 'Return is missing order line data for refund');
  }
  if (full.stripeRefundId) {
    return idempotentResult(full);
  }

  if (!isRefundablePaymentStatus(full.order.paymentStatus)) {
    throw new AppError(
      400,
      'Order is not in a refundable payment state',
      'ORDER_NOT_REFUNDABLE'
    );
  }

  const qty = full.acceptedQuantity != null ? full.acceptedQuantity : full.quantity;
  const refundAmountUsd = computeStandardReturnRefundAmount(full.orderItem, qty, full.order);
  const requestedCents = usdToCents(refundAmountUsd);
  if (requestedCents < 1) {
    throw new AppError(400, 'Refund amount must be greater than zero', 'REFUND_AMOUNT_INVALID');
  }

  const { stripe, paymentIntentId } = await resolvePaymentIntentId(full.order);

  let stripeBalance;
  try {
    stripeBalance = await fetchStripeRefundBalance(stripe, paymentIntentId);
  } catch (err) {
    console.error('[return-refund] failed to load Stripe balance', full.publicId, err);
    throw new AppError(
      502,
      'Unable to verify remaining refundable balance with Stripe. Try again shortly.',
      'STRIPE_BALANCE_UNAVAILABLE'
    );
  }

  const remainingCents = resolveRemainingRefundableCents({
    stripeRemainingCents: stripeBalance?.remainingCents,
    localRemainingUsd: localRemainingRefundableUsd(full.order),
  });

  const within = assertRefundWithinRemaining(requestedCents, remainingCents);
  if (!within.ok) {
    throw new AppError(400, within.message, within.code);
  }

  // Stable per-return key so retries / double-clicks reuse the same Stripe refund.
  const idempotencyKey = `return-refund-${full.publicId}`.slice(0, 255);

  let refund;
  try {
    refund = await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        amount: requestedCents,
        metadata: {
          returnPublicId: full.publicId,
          orderPublicId: full.order.publicId,
          actorEmail: actor?.email || '',
          refundType: 'standard_return',
        },
      },
      { idempotencyKey }
    );
  } catch (err) {
    const mapped = mapStripeRefundError(err);
    if (mapped) throw mapped;
    // Uncertain / network failure: do not mark local refunded. Retry is safe via idempotency key.
    console.error('[return-refund] Stripe refund create failed', full.publicId, err);
    throw new AppError(
      502,
      'Stripe refund failed. No local refund was recorded — safe to retry.',
      'STRIPE_REFUND_FAILED'
    );
  }

  // Re-read Stripe balance after refund for authoritative payment status.
  let balanceAfter = stripeBalance
    ? {
        amountPaidCents: stripeBalance.amountPaidCents,
        amountRefundedCents: stripeBalance.amountRefundedCents + requestedCents,
        remainingCents: Math.max(0, stripeBalance.remainingCents - requestedCents),
      }
    : null;
  try {
    const fresh = await fetchStripeRefundBalance(stripe, paymentIntentId);
    if (fresh) balanceAfter = fresh;
  } catch {
    // Non-fatal — use optimistic post-refund totals from pre-balance + this refund.
  }
  if (!balanceAfter) {
    balanceAfter = extractStripeRefundBalance({
      amount_received: requestedCents,
      latest_charge: { amount: requestedCents, amount_refunded: requestedCents },
    });
  }

  let refundPaymentMethodLabel = null;
  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ['payment_method', 'latest_charge'],
    });
    const pm =
      typeof pi.payment_method === 'object' && pi.payment_method ? pi.payment_method : null;
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

  let persisted;
  try {
    persisted = await persistReturnRefundAndOrderState({
      returnRequestId: full.id,
      orderId: full.order.id,
      refundAmountUsd,
      stripeRefundId: refund.id,
      refundPaymentMethodLabel,
      amountPaidCents: balanceAfter.amountPaidCents,
      amountRefundedCentsAfter: balanceAfter.amountRefundedCents,
      actor,
      returnPublicId: full.publicId,
      returnStatus: full.status,
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    // Stripe succeeded; local persist failed. Retry is safe via idempotency key + stripeRefundId null check.
    console.error(
      '[return-refund] Stripe refund succeeded but local persist failed',
      full.publicId,
      refund.id,
      err
    );
    throw new AppError(
      500,
      `Stripe refund ${refund.id} succeeded but local recording failed. Retry this refund to reconcile.`,
      'RETURN_REFUND_PERSIST_FAILED',
      { stripeRefundId: refund.id, refundAmountUsd }
    );
  }

  if (!persisted.skipped && full.user?.email) {
    try {
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
    } catch (emailErr) {
      console.error('[return-refund] confirmation email failed', full.publicId, emailErr);
    }
  }

  return {
    skipped: Boolean(persisted.skipped),
    refundAmount: persisted.refundAmount ?? refundAmountUsd,
    stripeRefundId: persisted.stripeRefundId || refund.id,
    returnRequest: persisted.returnRequest,
    paymentStatus: persisted.paymentStatus,
  };
}

export {
  derivePaymentStatusFromRefundTotals,
  isRefundablePaymentStatus,
  assertRefundWithinRemaining,
  moneyRound,
};
