import { prisma } from '../lib/prisma.js';
import { config } from '../config/env.js';
import { AppError } from '../utils/error-handler.js';
import { writeAdminAudit } from './audit.service.js';
import { emailService } from './email.service.js';
import { getBusinessSettings } from './admin.service.js';
import { restockOrderLineStock } from './inventory-reservation.js';
import { refurbishmentService } from './refurbishment.service.js';
import { markUnitsReturnedForReturn } from './product-unit.service.js';
import { shippingService } from './shipping.service.js';
import { notifyEligibilityReview, notifyInspectionQueued, notifyReturnRequest } from './admin-notification.service.js';
import {
  returnableQuantityForLine,
  TERMINAL_RETURN_REJECT_STATUSES,
} from '../lib/return-quantity-policy.js';
import {
  buildDemoReturnLabel,
  demoTrackingNextStatus,
  isDemoReturnTracking,
  useDemoReturnLabels,
} from './shipping/demo-return-label.js';
import {
  evaluateRefurbQuestionnaire,
  initialReturnStatusForDecision,
} from './refurb-eligibility.service.js';
import { computeRefurbStoreCredit, getAccessUsedReturnWindowDays } from '../config/refurb.config.js';
import { verifyOrderTrackingToken } from '../lib/order-tracking-token.js';
import { appendReturnStatusEvent, listReturnStatusEvents, appendReturnActionNote } from './return-status-events.service.js';
import {
  computeStandardReturnRefundAmount,
  processStandardReturnRefund,
} from './return-refund.service.js';

function isMissingWalletTableError(error) {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error.code === 'P2021' || error.code === 'P2022')
  );
}

const STANDARD_TRANSITIONS = {
  REQUESTED: ['RECEIVED', 'UNDER_INSPECTION', 'APPROVED', 'REJECTED'],
  RECEIVED: ['UNDER_INSPECTION', 'APPROVED', 'REJECTED'],
  UNDER_INSPECTION: ['APPROVED', 'REJECTED'],
  APPROVED: [],
  REJECTED: [],
};

const REFURB_TRANSITIONS = {
  REQUESTED: ['ELIGIBILITY_REVIEW', 'ELIGIBILITY_REJECTED', 'APPROVED', 'REJECTED'],
  ELIGIBILITY_REVIEW: ['APPROVED', 'ELIGIBILITY_REJECTED', 'REJECTED'],
  ELIGIBILITY_REJECTED: [],
  APPROVED: ['LABEL_GENERATED', 'REJECTED'],
  LABEL_GENERATED: ['IN_TRANSIT', 'RECEIVED', 'REJECTED'],
  IN_TRANSIT: ['RECEIVED', 'REJECTED'],
  RECEIVED: ['UNDER_INSPECTION'],
  UNDER_INSPECTION: ['INSPECTION_APPROVED', 'INSPECTION_REJECTED'],
  INSPECTION_APPROVED: [],
  INSPECTION_REJECTED: [],
  REJECTED: [],
};

const returnInclude = {
  user: { select: { publicId: true, email: true, firstName: true, lastName: true } },
  order: {
    select: {
      id: true,
      publicId: true,
      orderNumber: true,
      status: true,
      createdAt: true,
      deliveredAt: true,
      returnEnvelopeUsed: true,
      shippingCost: true,
      totalAmount: true,
    },
  },
  orderItem: {
    include: {
      product: {
        select: { publicId: true, name: true, productType: true, sku: true, slug: true },
      },
    },
  },
  eligibilityQuestionnaire: true,
  inspectionRecords: { orderBy: { createdAt: 'desc' }, take: 10 },
  refurbishmentJob: {
    include: {
      listedProduct: { select: { publicId: true, name: true, slug: true, conditionGrade: true } },
      inspectionRecords: { orderBy: { createdAt: 'desc' }, take: 5 },
    },
  },
};

async function resolveActorUserId(actor) {
  if (!actor?.id) return null;
  const user = await prisma.user.findUnique({ where: { publicId: actor.id }, select: { id: true } });
  return user?.id ?? null;
}

export function resolveStandardReturnWindowStart(order) {
  if (order?.deliveredAt) return new Date(order.deliveredAt);
  if (String(order?.status || '').toUpperCase().includes('DELIVER')) {
    return new Date(order.createdAt);
  }
  return null;
}

export function standardReturnWindowDaysLeft(order, windowDays = 14) {
  const start = resolveStandardReturnWindowStart(order);
  if (!start) return 0;
  const end = start.getTime() + windowDays * 24 * 60 * 60 * 1000;
  return Math.max(0, Math.ceil((end - Date.now()) / (24 * 60 * 60 * 1000)));
}

export class ReturnsService {
  validateTransition(current, next, type = 'STANDARD') {
    const map = type === 'REFURBISHMENT' ? REFURB_TRANSITIONS : STANDARD_TRANSITIONS;
    return (map[current] || []).includes(next);
  }

  async listAll(filters = {}) {
    const where = {};
    if (filters.type) where.type = filters.type;
    if (filters.status) where.status = filters.status;
    return prisma.returnRequest.findMany({
      where,
      include: returnInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  async listForUser(userPublicId) {
    const user = await prisma.user.findUnique({ where: { publicId: userPublicId }, select: { id: true } });
    if (!user) throw new AppError(401, 'Unauthorized');
    return prisma.returnRequest.findMany({
      where: { userId: user.id },
      include: returnInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  async getForUser(userPublicId, returnPublicId) {
    const user = await prisma.user.findUnique({ where: { publicId: userPublicId }, select: { id: true } });
    if (!user) throw new AppError(401, 'Unauthorized');
    const row = await prisma.returnRequest.findUnique({
      where: { publicId: returnPublicId },
      include: returnInclude,
    });
    if (!row || row.userId !== user.id) throw new AppError(404, 'Return request not found');
    const statusEvents = await listReturnStatusEvents(row.id);
    const refundPreview =
      row.type === 'STANDARD' && row.orderItem
        ? computeStandardReturnRefundAmount(row.orderItem, row.quantity)
        : null;
    return { ...row, statusEvents, refundPreview };
  }

  async getById(returnPublicId) {
    const row = await prisma.returnRequest.findUnique({
      where: { publicId: returnPublicId },
      include: returnInclude,
    });
    if (!row) throw new AppError(404, 'Return request not found');
    const statusEvents = await listReturnStatusEvents(row.id);
    const refundPreview =
      row.type === 'STANDARD' && row.orderItem
        ? computeStandardReturnRefundAmount(row.orderItem, row.quantity)
        : null;
    return { ...row, statusEvents, refundPreview };
  }

  async trackGuestReturn({ returnId, email }) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail) throw new AppError(400, 'Email is required');
    const row = await prisma.returnRequest.findUnique({
      where: { publicId: returnId },
      include: {
        ...returnInclude,
        user: { select: { email: true } },
      },
    });
    if (!row || String(row.user?.email || '').toLowerCase() !== normalizedEmail) {
      throw new AppError(404, 'Return not found');
    }
    const statusEvents = await listReturnStatusEvents(row.id);
    return { ...row, statusEvents };
  }

  resolveOrderItemIds(payload, order) {
    if (payload.orderItemIds?.length) return payload.orderItemIds;
    if (payload.orderItemId) return [payload.orderItemId];
    const first = order.orderItems[0]?.publicId;
    return first ? [first] : [];
  }

  async createForUser(userPublicId, payload) {
    const user = await prisma.user.findUnique({
      where: { publicId: userPublicId },
      select: { id: true, accessMemberUntil: true },
    });
    if (!user) throw new AppError(401, 'Unauthorized');

    const order = await prisma.order.findUnique({
      where: { publicId: payload.orderId },
      include: { orderItems: { include: { product: true } } },
    });
    if (!order || order.userId !== user.id) throw new AppError(404, 'Order not found');

    const itemPublicIds = this.resolveOrderItemIds(payload, order);
    if (itemPublicIds.length === 0) throw new AppError(404, 'Order item not found');

    if (payload.type === 'REFURBISHMENT') {
      const { isRefurbishedEnabled } = await import('../config/feature-flags.js');
      if (!isRefurbishedEnabled()) {
        throw new AppError(403, 'Refurbishment returns are not available yet');
      }
      const hasAccess = Boolean(user.accessMemberUntil && user.accessMemberUntil > new Date());
      if (!hasAccess) throw new AppError(403, 'ACCESS membership required for refurbishment returns');
      if (itemPublicIds.length !== 1) {
        throw new AppError(400, 'One item per refurb return');
      }
      const targetItem = order.orderItems.find((i) => i.publicId === itemPublicIds[0]);
      if (!targetItem) throw new AppError(404, 'Order item not found');
      const windowDays = await getAccessUsedReturnWindowDays();
      const usedAgeDays = (Date.now() - new Date(order.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      if (usedAgeDays > windowDays) {
        throw new AppError(400, `Used return window (${windowDays} days) has passed`);
      }
    }

    if (payload.type === 'STANDARD') {
      if (!resolveStandardReturnWindowStart(order)) {
        throw new AppError(400, 'Standard returns become available after delivery');
      }
      if (standardReturnWindowDaysLeft(order) <= 0) {
        throw new AppError(400, 'Standard return window (14 days from delivery) has passed');
      }
    }

    const existing = await prisma.returnRequest.findMany({
      where: {
        orderId: order.id,
        orderItem: { publicId: { in: itemPublicIds } },
        status: { notIn: [...TERMINAL_RETURN_REJECT_STATUSES] },
      },
      select: {
        publicId: true,
        status: true,
        type: true,
        quantity: true,
        orderItem: { select: { publicId: true, quantity: true } },
      },
    });

    const existingByItemId = new Map();
    for (const row of existing) {
      const itemId = row.orderItem?.publicId;
      if (!itemId) continue;
      if (!existingByItemId.has(itemId)) existingByItemId.set(itemId, []);
      existingByItemId.get(itemId).push(row);
    }

    const insufficient = [];
    const pendingIds = [];
    for (const publicId of itemPublicIds) {
      const orderItem = order.orderItems.find((i) => i.publicId === publicId);
      if (!orderItem) continue;
      const lineReturns = existingByItemId.get(publicId) ?? [];
      const returnable = returnableQuantityForLine({
        quantity: orderItem.quantity,
        returnRequests: lineReturns,
      });
      const requestedQty =
        payload.type === 'REFURBISHMENT'
          ? 1
          : Number(payload.quantities?.[publicId] ?? payload.quantity ?? 1);
      const qty = Math.max(1, Number.isFinite(requestedQty) ? requestedQty : 1);

      if (returnable <= 0) {
        insufficient.push({ orderItemId: publicId, openReturns: lineReturns });
        continue;
      }
      if (qty > returnable) {
        throw new AppError(
          400,
          `You can return at most ${returnable} unit${returnable === 1 ? '' : 's'} for this line item`,
          'RETURN_QUANTITY_EXCEEDED',
          { orderItemId: publicId, returnable, requested: qty }
        );
      }
      pendingIds.push(publicId);
    }

    if (pendingIds.length === 0) {
      const flatExisting = insufficient.flatMap((entry) => entry.openReturns);
      const summary = flatExisting
        .map((r) => `${r.orderItem?.publicId}: ${r.status} (${r.publicId})`)
        .join(', ');
      throw new AppError(
        409,
        'Selected items on this order already have an open return request',
        'RETURN_ALREADY_OPEN',
        {
          orderId: order.publicId,
          orderNumber: order.orderNumber,
          existingReturns: flatExisting.map((r) => ({
            returnId: r.publicId,
            status: r.status,
            type: r.type,
            orderItemId: r.orderItem?.publicId,
            orderId: order.publicId,
            orderNumber: order.orderNumber,
          })),
          summary,
        }
      );
    }

    let eligibilityEval = null;
    if (payload.type === 'REFURBISHMENT') {
      eligibilityEval = evaluateRefurbQuestionnaire(payload.questionnaire, payload.photoUrls);
    }

    const created = [];
    for (const publicId of pendingIds) {
      const orderItem = order.orderItems.find((i) => i.publicId === publicId);
      if (!orderItem) throw new AppError(404, 'Order item not found');
      if (payload.type === 'STANDARD' && orderItem.product?.productType === 'REFURBISHED') {
        throw new AppError(400, 'Standard returns are only available for eligible new items');
      }

      const initialStatus =
        payload.type === 'REFURBISHMENT'
          ? initialReturnStatusForDecision(eligibilityEval.decision)
          : 'REQUESTED';

      // Partial returns: clamp the requested quantity to what was purchased.
      // Refurb returns are always one unit at a time.
      const purchasedQty = Math.max(1, Number(orderItem.quantity || 1));
      const requestedQty =
        payload.type === 'REFURBISHMENT'
          ? 1
          : Number(payload.quantities?.[publicId] ?? payload.quantity ?? 1);
      const quantity = Math.min(purchasedQty, Math.max(1, Number.isFinite(requestedQty) ? requestedQty : 1));

      const row = await prisma.$transaction(async (tx) => {
        const rr = await tx.returnRequest.create({
          data: {
            userId: user.id,
            orderId: order.id,
            orderItemId: orderItem.id,
            type: payload.type,
            reason: payload.reason,
            notes: payload.notes ? String(payload.notes).trim() : null,
            photoUrlsJson:
              payload.type === 'STANDARD' && payload.photoUrls ? payload.photoUrls : undefined,
            status: initialStatus,
            quantity,
          },
        });

        await appendReturnStatusEvent(tx, {
          returnRequestId: rr.id,
          fromStatus: null,
          toStatus: initialStatus,
          note: 'Return submitted',
        });

        if (payload.type === 'REFURBISHMENT' && eligibilityEval) {
          await tx.returnEligibilityQuestionnaire.create({
            data: {
              returnRequestId: rr.id,
              answersJson: payload.questionnaire,
              photoUrlsJson: payload.photoUrls ?? {},
              autoDecision: eligibilityEval.decision,
              autoDecisionReasons: eligibilityEval.reasons,
            },
          });
        }

        return tx.returnRequest.findUnique({
          where: { id: rr.id },
          include: returnInclude,
        });
      });

      created.push(row);
      try {
        if (row.status === 'ELIGIBILITY_REVIEW') {
          notifyEligibilityReview(row);
        } else {
          notifyReturnRequest(row);
        }
      } catch (err) {
        console.error('[returns] admin notification failed', row.publicId, err);
      }
      if (row.user?.email) {
        try {
          await emailService.sendTemplate({
            to: row.user.email,
            template: 'return-requested',
            context: {
              name: [row.user.firstName, row.user.lastName].filter(Boolean).join(' '),
              returnType: payload.type === 'REFURBISHMENT' ? 'Used product return' : 'Standard return',
              actionUrl: `${config.frontend.customerUrl}/dashboard/returns/${row.publicId}`,
            },
          });
        } catch (err) {
          console.error('[returns] customer return-requested email failed', row.publicId, err);
        }
      }
    }

    return created.length === 1 ? created[0] : created;
  }

  /**
   * Guest self-service return: validate Order number + email (or a tracking token),
   * then create a STANDARD return on the matched order. UPS only; the one-envelope
   * rule applies when an admin issues the label.
   */
  async createForGuest(payload) {
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

    const order = await prisma.order.findFirst({
      where: {
        OR: [{ orderNumber }, { publicId: orderNumber }],
        contactEmail: { equals: email, mode: 'insensitive' },
      },
      select: { publicId: true, user: { select: { publicId: true } } },
    });
    if (!order || !order.user) {
      throw new AppError(404, 'Order not found for that email');
    }

    return this.createForUser(order.user.publicId, {
      orderId: order.publicId,
      orderItemId: payload.orderItemId,
      orderItemIds: payload.orderItemIds,
      type: 'STANDARD',
      reason: payload.reason,
    });
  }

  async reviewEligibility(returnPublicId, { decision, notes }, actor) {
    const rr = await prisma.returnRequest.findUnique({
      where: { publicId: returnPublicId },
      include: { eligibilityQuestionnaire: true, user: { select: { email: true, firstName: true, lastName: true } } },
    });
    if (!rr) throw new AppError(404, 'Return request not found');
    if (rr.type !== 'REFURBISHMENT') throw new AppError(400, 'Not a refurbishment return');
    if (rr.status !== 'ELIGIBILITY_REVIEW') {
      throw new AppError(400, 'Return is not awaiting eligibility review');
    }

    const nextStatus = decision === 'approve' ? 'APPROVED' : 'ELIGIBILITY_REJECTED';
    const reviewerId = await resolveActorUserId(actor);

    const updated = await prisma.$transaction(async (tx) => {
      if (rr.eligibilityQuestionnaire) {
        await tx.returnEligibilityQuestionnaire.update({
          where: { id: rr.eligibilityQuestionnaire.id },
          data: {
            reviewedByUserId: reviewerId,
            reviewedAt: new Date(),
            reviewNotes: notes ? String(notes).trim() : null,
          },
        });
      }
      const row = await tx.returnRequest.update({
        where: { id: rr.id },
        data: {
          status: nextStatus,
          notes: notes !== undefined ? (notes ? String(notes).trim() : null) : undefined,
        },
        include: returnInclude,
      });
      await appendReturnStatusEvent(tx, {
        returnRequestId: rr.id,
        fromStatus: rr.status,
        toStatus: nextStatus,
        actorUserId: reviewerId,
        note: notes ? String(notes).trim() : `Eligibility ${decision}`,
      });
      return row;
    });

    await writeAdminAudit({
      actorId: actor?.id,
      actorEmail: actor?.email,
      action: 'RETURN_ELIGIBILITY_REVIEW',
      entityType: 'ReturnRequest',
      entityId: returnPublicId,
      meta: { decision, to: nextStatus },
    });

    await emailService.sendTemplate({
      to: rr.user.email,
      template: 'return-status',
      context: {
        name: [rr.user.firstName, rr.user.lastName].filter(Boolean).join(' '),
        status: nextStatus,
        actionUrl: `${config.frontend.customerUrl}/dashboard/returns/${returnPublicId}`,
      },
    });

    return updated;
  }

  async generateReturnLabel(returnPublicId, payload, actor) {
    const rr = await prisma.returnRequest.findUnique({
      where: { publicId: returnPublicId },
      include: {
        order: { select: { id: true, shippingAddressJson: true, returnEnvelopeUsed: true } },
        user: { select: { email: true, firstName: true, lastName: true } },
      },
    });
    if (!rr) throw new AppError(404, 'Return request not found');
    if (rr.type === 'REFURBISHMENT' && !['APPROVED', 'LABEL_GENERATED'].includes(rr.status)) {
      throw new AppError(400, 'Return must be eligibility-approved before generating a label');
    }

    // One prepaid return envelope per order. The first return (of any type) gets a
    // prepaid UPS label; later returns on the same order require self-postage.
    if (rr.order.returnEnvelopeUsed && !rr.returnLabelUrl) {
      return { return: rr, label: null, selfPostageRequired: true };
    }

    const fromAddress = rr.order.shippingAddressJson;
    if (!fromAddress) throw new AppError(400, 'Order has no shipping address for return label');

    const label = useDemoReturnLabels()
      ? buildDemoReturnLabel(returnPublicId)
      : await shippingService.generateLabel({
          ...payload,
          fromAddress,
          toAddress: shippingService.getConfiguredOriginAddress(),
        });

    const updated = await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: rr.order.id },
        data: { returnEnvelopeUsed: true },
      });
      const row = await tx.returnRequest.update({
        where: { id: rr.id },
        data: {
          status: 'LABEL_GENERATED',
          returnLabelUrl: label.shippingLabelUrl || rr.returnLabelUrl,
          returnTrackingNumber: label.trackingNumber || rr.returnTrackingNumber,
          returnShippingCarrier: label.shippingCarrier || rr.returnShippingCarrier,
          returnShipmentId: payload?.shipmentId ? String(payload.shipmentId) : rr.returnShipmentId,
          returnTransactionId: label.transactionId || rr.returnTransactionId,
          labelGeneratedAt: new Date(),
        },
        include: returnInclude,
      });
      const actorUserId = await resolveActorUserId(actor);
      await appendReturnStatusEvent(tx, {
        returnRequestId: rr.id,
        fromStatus: rr.status,
        toStatus: 'LABEL_GENERATED',
        actorUserId,
        note: label.trackingNumber ? `Label generated · ${label.trackingNumber}` : 'Return label generated',
      });
      return row;
    });

    await writeAdminAudit({
      actorId: actor?.id,
      actorEmail: actor?.email,
      action: 'RETURN_LABEL_GENERATED',
      entityType: 'ReturnRequest',
      entityId: returnPublicId,
      meta: {
        trackingNumber: updated.returnTrackingNumber,
        demo: useDemoReturnLabels(),
      },
    });

    return { return: updated, label };
  }

  resolveReturnStatusFromTracking(trackingStatus, currentStatus) {
    const statusUp = String(trackingStatus || '').toUpperCase();
    if (
      statusUp.includes('DELIVERED') ||
      statusUp.includes('DELIVERY') ||
      statusUp.includes('PICKED UP')
    ) {
      return 'RECEIVED';
    }
    if (
      statusUp.includes('TRANSIT') ||
      statusUp.includes('DEPART') ||
      statusUp.includes('ARRIVAL') ||
      statusUp.includes('SCAN') ||
      statusUp.includes('OUT FOR')
    ) {
      return currentStatus === 'RECEIVED' ? 'RECEIVED' : 'IN_TRANSIT';
    }
    return null;
  }

  async syncReturnTracking(returnPublicId) {
    const rr = await prisma.returnRequest.findUnique({
      where: { publicId: returnPublicId },
      include: returnInclude,
    });
    if (!rr?.returnTrackingNumber) return rr;
    if (!['LABEL_GENERATED', 'IN_TRANSIT'].includes(rr.status)) return rr;

    if (isDemoReturnTracking(rr.returnTrackingNumber, rr.returnShippingCarrier)) {
      const nextStatus = demoTrackingNextStatus(rr.status);
      if (!nextStatus || !this.validateTransition(rr.status, nextStatus, rr.type)) return rr;

      const data = { status: nextStatus };
      if (nextStatus === 'RECEIVED') data.receivedAt = new Date();

      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.returnRequest.update({
          where: { id: rr.id },
          data,
          include: returnInclude,
        });
        await appendReturnStatusEvent(tx, {
          returnRequestId: rr.id,
          fromStatus: rr.status,
          toStatus: nextStatus,
          note: `Tracking sync (demo) · ${nextStatus}`,
        });
        if (nextStatus === 'RECEIVED') {
          await markUnitsReturnedForReturn(tx, rr.id);
        }
        return row;
      });

      return updated;
    }

    const t = await shippingService.trackShipment(
      rr.returnShippingCarrier || 'UPS',
      rr.returnTrackingNumber
    );
    const nextStatus = this.resolveReturnStatusFromTracking(t.status, rr.status);
    if (!nextStatus || nextStatus === rr.status) return rr;
    if (!this.validateTransition(rr.status, nextStatus, rr.type)) return rr;

    const data = { status: nextStatus };
    if (nextStatus === 'RECEIVED') data.receivedAt = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.returnRequest.update({
        where: { id: rr.id },
        data,
        include: returnInclude,
      });
      await appendReturnStatusEvent(tx, {
        returnRequestId: rr.id,
        fromStatus: rr.status,
        toStatus: nextStatus,
        note: `Tracking sync · ${t.status || nextStatus}`,
      });
      if (nextStatus === 'RECEIVED') {
        await markUnitsReturnedForReturn(tx, rr.id);
      }
      return row;
    });

    return updated;
  }

  async syncReturnTrackingBatch() {
    const rows = await prisma.returnRequest.findMany({
      where: {
        type: 'REFURBISHMENT',
        returnTrackingNumber: { not: null },
        status: { in: ['LABEL_GENERATED', 'IN_TRANSIT'] },
      },
      take: 40,
      orderBy: { updatedAt: 'asc' },
    });
    let touched = 0;
    for (const row of rows) {
      try {
        await this.syncReturnTracking(row.publicId);
        touched += 1;
      } catch {
        /* ignore per-row carrier errors */
      }
    }
    return { scanned: rows.length, touched };
  }

  async createInspectionRecord(returnPublicId, body, actor) {
    const rr = await prisma.returnRequest.findUnique({
      where: { publicId: returnPublicId },
      include: { refurbishmentJob: true },
    });
    if (!rr) throw new AppError(404, 'Return request not found');

    const inspectorUserId = await resolveActorUserId(actor);
    const record = await prisma.$transaction(async (tx) => {
      const created = await tx.refurbInspectionRecord.create({
        data: {
          returnRequestId: body.target === 'job' ? null : rr.id,
          refurbishmentJobId:
            body.target === 'job' ? rr.refurbishmentJob?.id ?? null : rr.refurbishmentJob?.id ?? null,
          inspectorUserId,
          grade: body.grade,
          notes: body.notes ? String(body.notes).trim() : null,
          photoUrlsJson: body.photoUrls ?? undefined,
          tasksCompletedJson: body.tasksCompleted ?? undefined,
        },
      });
      if (body.target !== 'job') {
        await appendReturnActionNote(tx, {
          returnRequestId: rr.id,
          status: rr.status,
          actorUserId: inspectorUserId,
          note: `Physical inspection recorded${body.grade ? ` · grade ${body.grade}` : ''}`,
        });
      }
      return created;
    });

    await writeAdminAudit({
      actorId: actor?.id,
      actorEmail: actor?.email,
      action: 'REFURB_INSPECTION_RECORD',
      entityType: 'ReturnRequest',
      entityId: returnPublicId,
      meta: { grade: body.grade },
    });

    return record;
  }

  async awardRefurbStoreCredit(rr) {
    try {
      const wallet = await prisma.storeCreditWallet.upsert({
        where: { userId: rr.userId },
        update: {},
        create: { userId: rr.userId, balance: 0, heldBalance: 0 },
      });
      let itemMemberPrice = 0;
      let isRefurbishedItem = false;
      if (rr.orderItemId) {
        const line = await prisma.orderItem.findUnique({
          where: { id: rr.orderItemId },
          select: {
            price: true,
            memberPriceSnapshot: true,
            product: { select: { productType: true } },
          },
        });
        itemMemberPrice = Number(line?.memberPriceSnapshot ?? line?.price ?? 0);
        isRefurbishedItem = line?.product?.productType === 'REFURBISHED';
      }
      if (itemMemberPrice <= 0) {
        const settings = await getBusinessSettings();
        itemMemberPrice = Number(settings.accessMembershipPriceUsd ?? 50);
      }
      // Refurbished items are returnable via the used path but earn no store credit.
      const amount = isRefurbishedItem ? 0 : computeRefurbStoreCredit(itemMemberPrice);
      await prisma.storeCreditWallet.update({
        where: { id: wallet.id },
        data: { balance: wallet.balance + amount },
      });
      await prisma.storeCreditTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'EARNED',
          amount,
          note: `Reward from approved refurbishment return ${rr.publicId}`,
        },
      });
      await prisma.returnRequest.update({
        where: { id: rr.id },
        data: { creditAwarded: amount },
      });
      if (amount > 0) {
        await appendReturnActionNote(prisma, {
          returnRequestId: rr.id,
          status: rr.status,
          note: `Store credit awarded · $${amount.toFixed(2)}`,
        });
      }
      await emailService.sendTemplate({
        to: rr.user.email,
        template: 'store-credit-update',
        context: {
          name: [rr.user.firstName, rr.user.lastName].filter(Boolean).join(' '),
          amount: `$${amount.toFixed(2)}`,
          actionUrl: `${config.frontend.customerUrl}/dashboard/wallet`,
        },
      });
      return amount;
    } catch (error) {
      if (!isMissingWalletTableError(error)) throw error;
      return 0;
    }
  }

  async updateStatus(returnPublicId, body, actor) {
    const { status, notes, rejectionReason, inspectionChecklist, manualCarrier, manualTrackingNumber, manualShippedAt } =
      body;
    const rr = await prisma.returnRequest.findUnique({
      where: { publicId: returnPublicId },
      include: {
        user: { select: { email: true, firstName: true, lastName: true } },
        order: { select: { publicId: true } },
      },
    });
    if (!rr) throw new AppError(404, 'Return request not found');

    if (
      manualCarrier !== undefined ||
      manualTrackingNumber !== undefined ||
      manualShippedAt !== undefined
    ) {
      await prisma.returnRequest.update({
        where: { id: rr.id },
        data: {
          ...(manualCarrier !== undefined ? { manualCarrier: manualCarrier || null } : {}),
          ...(manualTrackingNumber !== undefined
            ? { manualTrackingNumber: manualTrackingNumber || null }
            : {}),
          ...(manualShippedAt !== undefined
            ? { manualShippedAt: manualShippedAt ? new Date(manualShippedAt) : null }
            : {}),
        },
      });
    }

    if (!status) {
      if (notes === undefined) return this.getById(returnPublicId);
      const updatedNotes = await prisma.returnRequest.update({
        where: { id: rr.id },
        data: { notes: notes ? String(notes).trim() : null },
        include: returnInclude,
      });
      await writeAdminAudit({
        actorId: actor?.id,
        actorEmail: actor?.email,
        action: 'RETURN_NOTES',
        entityType: 'ReturnRequest',
        entityId: returnPublicId,
        meta: { notes: updatedNotes.notes },
      });
      return this.getById(returnPublicId);
    }

    if (rr.status === status) {
      if (notes === undefined) return this.getById(returnPublicId);
      const updatedNotes = await prisma.returnRequest.update({
        where: { id: rr.id },
        data: { notes: notes ? String(notes).trim() : null },
        include: returnInclude,
      });
      await writeAdminAudit({
        actorId: actor?.id,
        actorEmail: actor?.email,
        action: 'RETURN_NOTES',
        entityType: 'ReturnRequest',
        entityId: returnPublicId,
        meta: { notes: updatedNotes.notes },
      });
      return this.getById(returnPublicId);
    }

    if (!this.validateTransition(rr.status, status, rr.type)) {
      throw new AppError(400, `Invalid return status transition: ${rr.status} -> ${status}`);
    }

    const data = { status };
    if (notes !== undefined) data.notes = notes ? String(notes).trim() : null;
    if (rejectionReason !== undefined) {
      data.rejectionReason = rejectionReason ? String(rejectionReason).trim() : null;
    }
    if (inspectionChecklist !== undefined) {
      data.inspectionChecklistJson = inspectionChecklist;
    }
    if (status === 'RECEIVED') data.receivedAt = new Date();
    if (status === 'INSPECTION_APPROVED') data.inspectionApprovedAt = new Date();

    const actorUserId = await resolveActorUserId(actor);

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.returnRequest.update({
        where: { id: rr.id },
        data,
        include: returnInclude,
      });
      await appendReturnStatusEvent(tx, {
        returnRequestId: rr.id,
        fromStatus: rr.status,
        toStatus: status,
        actorUserId,
        note: data.notes || data.rejectionReason || null,
      });
      return row;
    });

    await writeAdminAudit({
      actorId: actor?.id,
      actorEmail: actor?.email,
      action: 'RETURN_STATUS',
      entityType: 'ReturnRequest',
      entityId: returnPublicId,
      meta: { from: rr.status, to: status, notes: data.notes, rejectionReason: data.rejectionReason },
    });

    if (status === 'RECEIVED') {
      await prisma.$transaction(async (tx) => {
        await markUnitsReturnedForReturn(tx, rr.id);
      });
    }

    if (status === 'UNDER_INSPECTION') {
      try {
        notifyInspectionQueued(updated);
      } catch (err) {
        console.error('[returns] inspection queued notification failed', returnPublicId, err);
      }
    }

    if (status === 'APPROVED' && rr.type === 'STANDARD') {
      if (config.standardReturnRestock) {
        const full = await prisma.returnRequest.findUnique({
          where: { id: rr.id },
          include: { orderItem: true },
        });
        if (full?.orderItem) {
          const restockQty = Math.max(1, Number(full.quantity || 1));
          await prisma.$transaction(async (tx) => {
            const product = await tx.product.findUnique({
              where: { id: full.orderItem.productId },
              include: { variants: { orderBy: { sortOrder: 'asc' } } },
            });
            if (product) {
              await restockOrderLineStock(
                tx,
                product,
                full.orderItem.productVariantId,
                restockQty,
                { referenceType: 'return', referenceId: returnPublicId, note: 'Standard return approved' },
                'RESTOCK'
              );
            }
          });
        }
      }
      try {
        await processStandardReturnRefund({ ...rr, ...updated }, actor);
      } catch (err) {
        if (err instanceof AppError && err.code === 'STRIPE_NOT_CONFIGURED') {
          // Allow approval without Stripe in dev — refund fields stay null.
        } else {
          throw err;
        }
      }
    }

    if (status === 'INSPECTION_APPROVED' && rr.type === 'REFURBISHMENT') {
      await refurbishmentService.createJobForReturn(rr.id);
      const full = await prisma.returnRequest.findUnique({
        where: { id: rr.id },
        include: {
          user: { select: { email: true, firstName: true, lastName: true } },
          inspectionRecords: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      });
      await this.awardRefurbStoreCredit({ ...rr, ...full, ...updated });
      const withJob = await prisma.returnRequest.findUnique({
        where: { id: rr.id },
        include: returnInclude,
      });
      if (withJob) {
        await emailService.sendTemplate({
          to: rr.user.email,
          template: 'return-status',
          context: {
            name: [rr.user.firstName, rr.user.lastName].filter(Boolean).join(' '),
            status,
            actionUrl: `${config.frontend.customerUrl}/dashboard/returns/${returnPublicId}`,
          },
        });
        return this.getById(returnPublicId);
      }
    }

    const emailNote =
      status === 'REJECTED' || status === 'INSPECTION_REJECTED'
        ? data.rejectionReason || 'See return details for more information.'
        : status === 'APPROVED' && rr.type === 'STANDARD'
          ? 'Your product refund has been initiated. Original shipping charges are not refunded.'
          : undefined;

    await emailService.sendTemplate({
      to: rr.user.email,
      template: 'return-status',
      context: {
        name: [rr.user.firstName, rr.user.lastName].filter(Boolean).join(' '),
        status,
        note: emailNote,
        actionUrl: `${config.frontend.customerUrl}/dashboard/returns/${returnPublicId}`,
      },
    });

    return this.getById(returnPublicId);
  }
  async bulkMarkReceived(returnPublicIds, actor) {
    const results = [];
    for (const id of returnPublicIds) {
      try {
        const row = await this.updateStatus(id, { status: 'RECEIVED' }, actor);
        results.push({ id, ok: true, return: row });
      } catch (e) {
        results.push({ id, ok: false, error: e.message });
      }
    }
    return { results };
  }
}

export const returnsService = new ReturnsService();
