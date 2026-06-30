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
import { computeRefurbStoreCredit } from '../config/refurb.config.js';
import { verifyOrderTrackingToken } from '../lib/order-tracking-token.js';

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
  order: { select: { id: true, publicId: true, orderNumber: true, status: true, createdAt: true } },
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
    return row;
  }

  async getById(returnPublicId) {
    const row = await prisma.returnRequest.findUnique({
      where: { publicId: returnPublicId },
      include: returnInclude,
    });
    if (!row) throw new AppError(404, 'Return request not found');
    return row;
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
      const { ACCESS_USED_RETURN_WINDOW_DAYS } = await import('../config/refurb.config.js');
      const usedAgeDays = (Date.now() - new Date(order.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      if (usedAgeDays > ACCESS_USED_RETURN_WINDOW_DAYS) {
        throw new AppError(400, 'Used return window (12 months) has passed');
      }
    }

    if (payload.type === 'STANDARD') {
      const ageDays = (Date.now() - new Date(order.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      if (ageDays > 14) throw new AppError(400, 'Standard return window (14 days) has passed');
    }

    const existing = await prisma.returnRequest.findMany({
      where: {
        orderId: order.id,
        orderItem: { publicId: { in: itemPublicIds } },
        status: { notIn: ['REJECTED', 'ELIGIBILITY_REJECTED', 'INSPECTION_REJECTED'] },
      },
      select: { orderItem: { select: { publicId: true } } },
    });
    const blocked = new Set(existing.map((r) => r.orderItem?.publicId).filter(Boolean));
    const pendingIds = itemPublicIds.filter((id) => !blocked.has(id));
    if (pendingIds.length === 0) {
      throw new AppError(400, 'Selected items already have an open return request');
    }

    let eligibilityEval = null;
    if (payload.type === 'REFURBISHMENT') {
      eligibilityEval = evaluateRefurbQuestionnaire(payload.questionnaire, payload.photoUrls);
    }

    const created = [];
    for (const publicId of pendingIds) {
      const orderItem = order.orderItems.find((i) => i.publicId === publicId);
      if (!orderItem) throw new AppError(404, 'Order item not found');

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
            status: initialStatus,
            quantity,
          },
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
      return tx.returnRequest.update({
        where: { id: rr.id },
        data: {
          status: nextStatus,
          notes: notes !== undefined ? (notes ? String(notes).trim() : null) : undefined,
        },
        include: returnInclude,
      });
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
      return tx.returnRequest.update({
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

      const updated = await prisma.returnRequest.update({
        where: { id: rr.id },
        data,
        include: returnInclude,
      });

      if (nextStatus === 'RECEIVED') {
        await prisma.$transaction(async (tx) => {
          await markUnitsReturnedForReturn(tx, rr.id);
        });
      }

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

    const updated = await prisma.returnRequest.update({
      where: { id: rr.id },
      data,
      include: returnInclude,
    });

    if (nextStatus === 'RECEIVED') {
      await prisma.$transaction(async (tx) => {
        await markUnitsReturnedForReturn(tx, rr.id);
      });
    }

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
    const record = await prisma.refurbInspectionRecord.create({
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

  async updateStatus(returnPublicId, { status, notes }, actor) {
    const rr = await prisma.returnRequest.findUnique({
      where: { publicId: returnPublicId },
      include: {
        user: { select: { email: true, firstName: true, lastName: true } },
        order: { select: { publicId: true } },
      },
    });
    if (!rr) throw new AppError(404, 'Return request not found');

    if (rr.status === status) {
      if (notes === undefined) return rr;
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
      return updatedNotes;
    }

    if (!this.validateTransition(rr.status, status, rr.type)) {
      throw new AppError(400, `Invalid return status transition: ${rr.status} -> ${status}`);
    }

    const data = { status };
    if (notes !== undefined) data.notes = notes ? String(notes).trim() : null;
    if (status === 'RECEIVED') data.receivedAt = new Date();
    if (status === 'INSPECTION_APPROVED') data.inspectionApprovedAt = new Date();

    const updated = await prisma.returnRequest.update({
      where: { id: rr.id },
      data,
      include: returnInclude,
    });

    await writeAdminAudit({
      actorId: actor?.id,
      actorEmail: actor?.email,
      action: 'RETURN_STATUS',
      entityType: 'ReturnRequest',
      entityId: returnPublicId,
      meta: { from: rr.status, to: status, notes: data.notes },
    });

    if (status === 'RECEIVED') {
      await prisma.$transaction(async (tx) => {
        await markUnitsReturnedForReturn(tx, rr.id);
      });
    }

    if (status === 'APPROVED' && rr.type === 'STANDARD' && config.standardReturnRestock) {
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
        return withJob;
      }
    }

    await emailService.sendTemplate({
      to: rr.user.email,
      template: 'return-status',
      context: {
        name: [rr.user.firstName, rr.user.lastName].filter(Boolean).join(' '),
        status,
        actionUrl: `${config.frontend.customerUrl}/dashboard/returns/${returnPublicId}`,
      },
    });

    return updated;
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
