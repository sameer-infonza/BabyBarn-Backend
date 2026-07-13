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
import { computeRefurbStoreCredit, getAccessUsedReturnWindowDays, refurbShipByDeadline } from '../config/refurb.config.js';
import { verifyOrderTrackingToken } from '../lib/order-tracking-token.js';
import { appendReturnStatusEvent, listReturnStatusEvents, appendReturnActionNote } from './return-status-events.service.js';
import {
  computeStandardReturnRefundAmount,
  processStandardReturnRefund,
} from './return-refund.service.js';
import { assignReturnNumber } from '../utils/return-number.js';
import { returnLedgerNote } from '../lib/inventory-ledger-notes.js';

function isMissingWalletTableError(error) {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error.code === 'P2021' || error.code === 'P2022')
  );
}

/** Strict standard ladder: Received → Inspection → Approve/Reject; refund/restock are separate actions. */
const STANDARD_TRANSITIONS = {
  REQUESTED: ['RECEIVED'],
  RECEIVED: ['UNDER_INSPECTION'],
  UNDER_INSPECTION: ['APPROVED', 'REJECTED'],
  APPROVED: [],
  REJECTED: [],
};

const REFURB_TRANSITIONS = {
  REQUESTED: ['ELIGIBILITY_REVIEW', 'ELIGIBILITY_REJECTED', 'APPROVED', 'REJECTED'],
  ELIGIBILITY_REVIEW: ['APPROVED', 'ELIGIBILITY_REJECTED', 'REJECTED'],
  ELIGIBILITY_REJECTED: [],
  APPROVED: ['IN_TRANSIT', 'CANCELLED', 'REJECTED'],
  LABEL_GENERATED: ['IN_TRANSIT', 'RECEIVED', 'REJECTED'],
  IN_TRANSIT: ['RECEIVED', 'REJECTED'],
  RECEIVED: ['UNDER_INSPECTION'],
  UNDER_INSPECTION: ['INSPECTION_APPROVED', 'INSPECTION_REJECTED'],
  INSPECTION_APPROVED: [],
  INSPECTION_REJECTED: [],
  REJECTED: [],
  CANCELLED: [],
};

const returnInclude = {
  user: {
    select: {
      publicId: true,
      email: true,
      firstName: true,
      lastName: true,
      isGuest: true,
      accessMemberUntil: true,
    },
  },
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
        select: { publicId: true, name: true, productType: true, sku: true, slug: true, sizeAgeGroup: true },
      },
      productVariant: {
        select: { publicId: true, sku: true, combination: true },
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

export function resolveUsedReturnWindowStart(order) {
  return resolveStandardReturnWindowStart(order);
}

function returnSubmissionKey(row) {
  return row?.submissionPublicId || row?.submissionId || row?.publicId || row?.id;
}

function computeRowRefundPreview(row) {
  return row?.type === 'STANDARD' && row?.orderItem
    ? computeStandardReturnRefundAmount(row.orderItem, row.quantity)
    : null;
}

function deriveSubmissionStatus(rows) {
  if (!rows.length) return 'REQUESTED';
  const statuses = rows.map((row) => row.status);
  if (statuses.every((status) => status === statuses[0])) return statuses[0];

  const type = rows[0].type;
  if (type === 'STANDARD') {
    if (statuses.every((status) => status === 'APPROVED')) return 'APPROVED';
    if (statuses.every((status) => status === 'REJECTED')) return 'REJECTED';
    if (statuses.includes('UNDER_INSPECTION')) return 'UNDER_INSPECTION';
    if (statuses.includes('RECEIVED')) return 'RECEIVED';
    if (statuses.includes('REQUESTED')) return 'REQUESTED';
    if (statuses.includes('APPROVED')) return 'APPROVED';
    return statuses[0];
  }

  if (statuses.every((status) => status === 'INSPECTION_APPROVED')) return 'INSPECTION_APPROVED';
  if (statuses.every((status) => ['ELIGIBILITY_REJECTED', 'INSPECTION_REJECTED', 'REJECTED'].includes(status))) {
    return statuses[0];
  }

  const refurbPriority = [
    'ELIGIBILITY_REVIEW',
    'APPROVED',
    'LABEL_GENERATED',
    'IN_TRANSIT',
    'RECEIVED',
    'UNDER_INSPECTION',
    'INSPECTION_APPROVED',
  ];
  for (const status of refurbPriority) {
    if (statuses.includes(status)) return status;
  }
  return statuses[0];
}

function buildSubmissionStatusEvents(rows) {
  return rows
    .flatMap((row) =>
      (row.statusEvents ?? []).map((event) => ({
        ...event,
        returnItemId: row.id || row.publicId,
        returnSubmissionId: returnSubmissionKey(row),
        itemName: row.orderItem?.product?.name || null,
        note:
          row.orderItem?.product?.name && event.note
            ? `${row.orderItem.product.name} — ${event.note}`
            : event.note || row.orderItem?.product?.name || null,
      }))
    )
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function checklistComplete(checklist) {
  if (!checklist || typeof checklist !== 'object') return false;
  const keys = [
    'correctProduct',
    'unused',
    'tagsAttached',
    'packagingAvailable',
    'noStains',
    'noDamage',
    'noMissingAccessories',
  ];
  return keys.every((k) => checklist[k] === true);
}

function computeRefurbCreditPreview(row) {
  if (row?.type !== 'REFURBISHMENT' || !row.orderItem) return null;
  if (row.orderItem.product?.productType === 'REFURBISHED') return 0;
  const unit = Number(row.orderItem.memberPriceSnapshot ?? row.orderItem.price ?? 0);
  const qty = Math.max(1, Number(row.quantity ?? 1));
  return Math.round(computeRefurbStoreCredit(unit) * qty * 100) / 100;
}

/** Admin refurb queue: hide APPROVED until customer submits USPS tracking or requests envelope. */
function isRefurbVisibleToAdmin(row, openPackageOrderIds = new Set()) {
  if (row.type !== 'REFURBISHMENT') return true;
  if (row.status === 'ELIGIBILITY_REVIEW') return true;
  if (['IN_TRANSIT', 'RECEIVED', 'UNDER_INSPECTION', 'INSPECTION_APPROVED', 'INSPECTION_REJECTED'].includes(row.status)) {
    return true;
  }
  if (row.customerShippingSubmittedAt || row.manualTrackingNumber) return true;
  if (openPackageOrderIds.has(row.orderId)) return true;
  return false;
}

async function loadOpenPackageOrderIds(orderIds = []) {
  if (!orderIds.length) return new Set();
  const rows = await prisma.returnPackageRequest.findMany({
    where: {
      orderId: { in: orderIds },
      status: { in: ['REQUESTED', 'APPROVED', 'SENT'] },
    },
    select: { orderId: true },
  });
  return new Set(rows.map((r) => r.orderId));
}

function buildSubmissionChildItem(row) {
  return {
    id: row.publicId,
    submissionId: returnSubmissionKey(row),
    returnNumber: row.returnNumber || null,
    type: row.type,
    status: row.status,
    quantity: row.quantity,
    reason: row.reason,
    notes: row.notes,
    rejectionReason: row.rejectionReason,
    photoUrlsJson: row.photoUrlsJson,
    creditAwarded: row.creditAwarded,
    refundAmount: row.refundAmount,
    stripeRefundId: row.stripeRefundId,
    refundedAt: row.refundedAt,
    refundPaymentMethodLabel: row.refundPaymentMethodLabel ?? null,
    refundPreview: row.refundPreview ?? computeRowRefundPreview(row),
    restockedAt: row.restockedAt ?? null,
    restockedQuantity: row.restockedQuantity ?? null,
    manualCarrier: row.manualCarrier,
    manualTrackingNumber: row.manualTrackingNumber,
    manualShippedAt: row.manualShippedAt,
    customerShippingNote: row.customerShippingNote ?? null,
    customerShippingPhotoUrl: row.customerShippingPhotoUrl ?? null,
    customerShippingSubmittedAt: row.customerShippingSubmittedAt ?? null,
    shipByDeadline: row.shipByDeadline ?? null,
    keepWaitingUntil: row.keepWaitingUntil ?? null,
    creditPreview: computeRefurbCreditPreview(row),
    returnLabelUrl: row.returnLabelUrl,
    returnTrackingNumber: row.returnTrackingNumber,
    returnShippingCarrier: row.returnShippingCarrier,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    user: row.user,
    order: row.order,
    orderItem: row.orderItem,
    eligibilityQuestionnaire: row.eligibilityQuestionnaire,
    inspectionRecords: row.inspectionRecords,
    refurbishmentJob: row.refurbishmentJob,
    statusEvents: row.statusEvents,
  };
}

function buildReturnSubmission(rows, { includeEvents = false } = {}) {
  if (!rows.length) return null;
  const ordered = [...rows].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const latestFirst = [...ordered].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const primary = ordered[0];
  const submissionId = returnSubmissionKey(primary);
  const items = ordered.map((row) => buildSubmissionChildItem({ ...row, submissionId }));
  const refundAmounts = items.map((row) => Number(row.refundAmount ?? 0));
  const hasExplicitRefundAmount = items.some((row) => row.refundAmount != null);
  const refundPreview = items.reduce((sum, row) => sum + Number(row.refundPreview ?? 0), 0);
  const creditAwarded = items.reduce((sum, row) => sum + Number(row.creditAwarded ?? 0), 0);
  const quantity = items.reduce((sum, row) => sum + Math.max(1, Number(row.quantity ?? 1)), 0);
  const statusEvents = includeEvents ? buildSubmissionStatusEvents(items) : undefined;
  const latestTrackingRow = latestFirst.find((row) => row.returnTrackingNumber || row.manualTrackingNumber || row.returnLabelUrl);

  const refundedAts = items.map((row) => row.refundedAt).filter(Boolean);
  const latestRefundedAt =
    refundedAts.length > 0
      ? refundedAts.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]
      : null;
  const refundPaymentMethodLabel =
    items.find((row) => row.refundPaymentMethodLabel)?.refundPaymentMethodLabel ?? null;

  const returnNumber =
    ordered.find((row) => row.returnNumber)?.returnNumber || primary.returnNumber || null;

  return {
    id: submissionId,
    submissionId,
    returnNumber,
    primaryItemId: primary.publicId,
    type: primary.type,
    status: deriveSubmissionStatus(items),
    reason: primary.reason,
    notes: primary.notes,
    rejectionReason: items.length === 1 ? primary.rejectionReason : null,
    createdAt: primary.createdAt,
    updatedAt: latestFirst[0]?.updatedAt ?? primary.updatedAt,
    quantity,
    photoUrlsJson:
      primary.type === 'STANDARD' && Array.isArray(primary.photoUrlsJson) ? primary.photoUrlsJson : null,
    creditAwarded,
    refundAmount: hasExplicitRefundAmount ? refundAmounts.reduce((sum, value) => sum + value, 0) : null,
    refundPreview: refundPreview > 0 ? refundPreview : null,
    stripeRefundId: items.length === 1 ? primary.stripeRefundId : null,
    refundedAt: latestRefundedAt,
    refundPaymentMethodLabel,
    manualCarrier: items.length === 1 ? primary.manualCarrier : latestTrackingRow?.manualCarrier ?? null,
    manualTrackingNumber:
      items.length === 1 ? primary.manualTrackingNumber : latestTrackingRow?.manualTrackingNumber ?? null,
    manualShippedAt: items.length === 1 ? primary.manualShippedAt : latestTrackingRow?.manualShippedAt ?? null,
    customerShippingNote: latestTrackingRow?.customerShippingNote ?? primary.customerShippingNote ?? null,
    customerShippingPhotoUrl:
      latestTrackingRow?.customerShippingPhotoUrl ?? primary.customerShippingPhotoUrl ?? null,
    customerShippingSubmittedAt:
      latestTrackingRow?.customerShippingSubmittedAt ?? primary.customerShippingSubmittedAt ?? null,
    shipByDeadline: primary.shipByDeadline ?? latestFirst.find((r) => r.shipByDeadline)?.shipByDeadline ?? null,
    keepWaitingUntil: primary.keepWaitingUntil ?? latestFirst.find((r) => r.keepWaitingUntil)?.keepWaitingUntil ?? null,
    creditPreview: items.reduce((sum, row) => sum + Number(row.creditPreview ?? 0), 0) || null,
    returnLabelUrl: latestTrackingRow?.returnLabelUrl ?? null,
    returnTrackingNumber: latestTrackingRow?.returnTrackingNumber ?? null,
    returnShippingCarrier: latestTrackingRow?.returnShippingCarrier ?? null,
    eligibilityQuestionnaire: items.length === 1 ? primary.eligibilityQuestionnaire : null,
    inspectionRecords: items.length === 1 ? primary.inspectionRecords : [],
    refurbishmentJob: items.length === 1 ? primary.refurbishmentJob : null,
    user: primary.user,
    order: primary.order,
    orderItem: items.length === 1 ? primary.orderItem : null,
    items,
    statusEvents,
  };
}

function groupReturnRows(rows, { includeEvents = false } = {}) {
  const groups = new Map();
  for (const row of rows) {
    const key = returnSubmissionKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()]
    .map((group) => buildReturnSubmission(group, { includeEvents }))
    .filter(Boolean)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export class ReturnsService {
  validateTransition(current, next, type = 'STANDARD') {
    const map = type === 'REFURBISHMENT' ? REFURB_TRANSITIONS : STANDARD_TRANSITIONS;
    return (map[current] || []).includes(next);
  }

  async listAll(filters = {}) {
    const where = {};
    if (filters.type) where.type = filters.type;
    if (filters.status && filters.status !== 'all') where.status = filters.status;
    let rows = await prisma.returnRequest.findMany({
      where,
      include: returnInclude,
      orderBy: { createdAt: 'desc' },
    });
    if (filters.adminVisible && filters.type === 'REFURBISHMENT') {
      const orderIds = [...new Set(rows.map((r) => r.orderId).filter(Boolean))];
      const openPkgOrders = await loadOpenPackageOrderIds(orderIds);
      rows = rows.filter((row) => isRefurbVisibleToAdmin(row, openPkgOrders));
    }
    // Flat rows for inspection/dashboard; grouped submissions for admin returns list.
    if (filters.grouped) return groupReturnRows(rows);
    return rows;
  }

  async listForUser(userPublicId) {
    const user = await prisma.user.findUnique({ where: { publicId: userPublicId }, select: { id: true } });
    if (!user) throw new AppError(401, 'Unauthorized');
    const rows = await prisma.returnRequest.findMany({
      where: { userId: user.id },
      include: returnInclude,
      orderBy: { createdAt: 'desc' },
    });
    return groupReturnRows(rows);
  }

  async getForUser(userPublicId, returnPublicId) {
    const user = await prisma.user.findUnique({ where: { publicId: userPublicId }, select: { id: true } });
    if (!user) throw new AppError(401, 'Unauthorized');
    let rows = await prisma.returnRequest.findMany({
      where: {
        userId: user.id,
        OR: [
          { publicId: returnPublicId },
          { submissionPublicId: returnPublicId },
          { returnNumber: returnPublicId },
        ],
      },
      include: returnInclude,
      orderBy: { createdAt: 'asc' },
    });
    if (rows.length === 1) {
      const key = returnSubmissionKey(rows[0]);
      if (key && key !== returnPublicId) {
        rows = await prisma.returnRequest.findMany({
          where: { userId: user.id, submissionPublicId: key },
          include: returnInclude,
          orderBy: { createdAt: 'asc' },
        });
      }
    }
    if (!rows.length) throw new AppError(404, 'Return request not found');
    const rowsWithEvents = await Promise.all(
      rows.map(async (row) => ({
        ...row,
        refundPreview: computeRowRefundPreview(row),
        statusEvents: await listReturnStatusEvents(row.id),
      }))
    );
    const submission = buildReturnSubmission(rowsWithEvents, { includeEvents: true });
    const packageRequest = await this.getPackageRequestForSubmission(rows);
    return { ...submission, packageRequest };
  }

  async getById(returnPublicId) {
    let row = await prisma.returnRequest.findUnique({
      where: { publicId: returnPublicId },
      include: returnInclude,
    });
    if (!row) {
      row = await prisma.returnRequest.findFirst({
        where: {
          OR: [{ submissionPublicId: returnPublicId }, { returnNumber: returnPublicId }],
        },
        include: returnInclude,
        orderBy: { createdAt: 'asc' },
      });
    }
    if (!row) throw new AppError(404, 'Return request not found');
    const submissionItems = await prisma.returnRequest.findMany({
      where: { submissionPublicId: returnSubmissionKey(row) },
      include: returnInclude,
      orderBy: { createdAt: 'asc' },
    });
    const statusEvents = await listReturnStatusEvents(row.id);
    const submissionRefundPreview = submissionItems.reduce(
      (sum, item) => sum + Number(computeRowRefundPreview(item) || 0),
      0
    );
    const submissionReturnNumber =
      submissionItems.find((item) => item.returnNumber)?.returnNumber || row.returnNumber || null;
    const rowsWithPreview = submissionItems.map((item) => ({
      ...item,
      refundPreview: computeRowRefundPreview(item),
    }));
    const submission = buildReturnSubmission(rowsWithPreview, { includeEvents: false });
    const packageRequest = await this.getPackageRequestForSubmission(submissionItems);
  return {
      ...submission,
      id: row.publicId,
      primaryItemId: row.publicId,
      statusEvents,
      returnNumber: submissionReturnNumber,
      submissionId: returnSubmissionKey(row),
      refundPreview: submissionRefundPreview > 0 ? submissionRefundPreview : submission?.refundPreview ?? null,
      submissionItems: rowsWithPreview.map((item) =>
        buildSubmissionChildItem(item)
      ),
      submissionStatus: deriveSubmissionStatus(submissionItems),
      submissionQuantity: submissionItems.reduce((sum, item) => sum + Math.max(1, Number(item.quantity ?? 1)), 0),
      refundAmount: submissionItems.some((i) => i.refundAmount != null)
        ? submissionItems.reduce((sum, i) => sum + Number(i.refundAmount || 0), 0)
        : row.refundAmount,
      refundedAt: submissionItems.map((i) => i.refundedAt).filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] || row.refundedAt,
      refundPaymentMethodLabel:
        submissionItems.find((i) => i.refundPaymentMethodLabel)?.refundPaymentMethodLabel ||
        row.refundPaymentMethodLabel,
      packageRequest,
      eligibilityQuestionnaire: row.eligibilityQuestionnaire,
      inspectionRecords: row.inspectionRecords,
      refurbishmentJob: row.refurbishmentJob,
      user: row.user,
      order: row.order,
      orderItem: submissionItems.length === 1 ? row.orderItem : null,
      type: row.type,
      status: deriveSubmissionStatus(submissionItems),
      reason: row.reason,
      notes: row.notes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async trackGuestReturn({ returnId, email }) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail) throw new AppError(400, 'Email is required');
    let rows = await prisma.returnRequest.findMany({
      where: {
        OR: [{ publicId: returnId }, { submissionPublicId: returnId }, { returnNumber: returnId }],
      },
      include: {
        ...returnInclude,
        user: { select: { email: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (rows.length === 1) {
      const key = returnSubmissionKey(rows[0]);
      if (key && key !== returnId) {
        rows = await prisma.returnRequest.findMany({
          where: { submissionPublicId: key },
          include: {
            ...returnInclude,
            user: { select: { email: true } },
          },
          orderBy: { createdAt: 'asc' },
        });
      }
    }
    if (!rows.length || String(rows[0].user?.email || '').toLowerCase() !== normalizedEmail) {
      throw new AppError(404, 'Return not found');
    }
    const rowsWithEvents = await Promise.all(
      rows.map(async (row) => ({
        ...row,
        refundPreview: computeRowRefundPreview(row),
        statusEvents: await listReturnStatusEvents(row.id),
      }))
    );
    return buildReturnSubmission(rowsWithEvents, { includeEvents: true });
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

    const refurbItems =
      payload.type === 'REFURBISHMENT'
        ? Array.isArray(payload.refurbItems) && payload.refurbItems.length > 0
          ? payload.refurbItems
          : [
              {
                orderItemId: payload.orderItemIds?.[0] || payload.orderItemId,
                quantity: payload.quantity ?? 1,
                questionnaire: payload.questionnaire,
                photoUrls: payload.photoUrls,
              },
            ].filter((item) => item.orderItemId)
        : [];
    const itemPublicIds =
      payload.type === 'REFURBISHMENT'
        ? refurbItems.map((item) => item.orderItemId)
        : this.resolveOrderItemIds(payload, order);
    if (itemPublicIds.length === 0) throw new AppError(404, 'Order item not found');
    if (new Set(itemPublicIds).size !== itemPublicIds.length) {
      throw new AppError(400, 'Each item can only be selected once per return request');
    }
    const refurbItemById = new Map(refurbItems.map((item) => [item.orderItemId, item]));

    if (payload.type === 'REFURBISHMENT') {
      const { isRefurbishedEnabled } = await import('../config/feature-flags.js');
      if (!isRefurbishedEnabled()) {
        throw new AppError(403, 'Refurbishment returns are not available yet');
      }
      const hasAccess = Boolean(user.accessMemberUntil && user.accessMemberUntil > new Date());
      if (!hasAccess) throw new AppError(403, 'ACCESS membership required for refurbishment returns');
      const windowStart = resolveUsedReturnWindowStart(order);
      if (!windowStart) {
        throw new AppError(400, 'Return Used Product becomes available after delivery');
      }
      const windowDays = await getAccessUsedReturnWindowDays();
      const usedAgeDays = (Date.now() - windowStart.getTime()) / (1000 * 60 * 60 * 24);
      if (usedAgeDays > windowDays) {
        throw new AppError(400, `Used return window (${windowDays} days from delivery) has passed`);
      }
      for (const publicId of itemPublicIds) {
        const targetItem = order.orderItems.find((i) => i.publicId === publicId);
        if (!targetItem) throw new AppError(404, 'Order item not found');
        if (targetItem.product?.productType === 'REFURBISHED') {
          throw new AppError(400, 'Return Used Product is only available for eligible new items');
        }
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
        submissionPublicId: true,
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
          ? Number(refurbItemById.get(publicId)?.quantity ?? 1)
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
            returnId: r.returnNumber || r.submissionPublicId || r.publicId,
            returnNumber: r.returnNumber || null,
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

    const eligibilityByItemId = new Map();
    if (payload.type === 'REFURBISHMENT') {
      for (const item of refurbItems) {
        eligibilityByItemId.set(item.orderItemId, evaluateRefurbQuestionnaire(item.questionnaire, item.photoUrls));
      }
    }

    const created = [];
    let submissionPublicId = null;
    for (const publicId of pendingIds) {
      const orderItem = order.orderItems.find((i) => i.publicId === publicId);
      if (!orderItem) throw new AppError(404, 'Order item not found');
      const refurbItem = refurbItemById.get(publicId);
      const eligibilityEval = payload.type === 'REFURBISHMENT' ? eligibilityByItemId.get(publicId) : null;

      const initialStatus =
        payload.type === 'REFURBISHMENT' && eligibilityEval
          ? initialReturnStatusForDecision(eligibilityEval.decision)
          : 'REQUESTED';

      // Partial returns: clamp the requested quantity to what was purchased.
      const purchasedQty = Math.max(1, Number(orderItem.quantity || 1));
      const requestedQty =
        payload.type === 'REFURBISHMENT'
          ? Number(refurbItem?.quantity ?? 1)
          : Number(payload.quantities?.[publicId] ?? payload.quantity ?? 1);
      const quantity = Math.min(purchasedQty, Math.max(1, Number.isFinite(requestedQty) ? requestedQty : 1));

      const row = await prisma.$transaction(async (tx) => {
        const rr = await tx.returnRequest.create({
          data: {
            ...(submissionPublicId ? { submissionPublicId } : {}),
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

        // One human-readable returnNumber per submission (first line only).
        if (!submissionPublicId) {
          await assignReturnNumber(tx, rr.id, payload.type);
        }

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
              answersJson: refurbItem?.questionnaire,
              photoUrlsJson: refurbItem?.photoUrls ?? {},
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

      if (!submissionPublicId) submissionPublicId = row.submissionPublicId || row.publicId;
      created.push(row);
    }

    const primaryRow = created[0];
    if (primaryRow) {
      try {
        if (created.some((row) => row.status === 'ELIGIBILITY_REVIEW')) {
          notifyEligibilityReview(primaryRow);
        } else {
          notifyReturnRequest(primaryRow);
        }
      } catch (err) {
        console.error('[returns] admin notification failed', primaryRow.publicId, err);
      }
      if (primaryRow.user?.email) {
        try {
          await emailService.sendTemplate({
            to: primaryRow.user.email,
            template: 'return-requested',
            context: {
              name: [primaryRow.user.firstName, primaryRow.user.lastName].filter(Boolean).join(' '),
              returnType: payload.type === 'REFURBISHMENT' ? 'Used product return' : 'Standard return',
              returnNumber: primaryRow.returnNumber || null,
              actionUrl: `${config.frontend.customerUrl}/dashboard/returns/${submissionPublicId || primaryRow.publicId}`,
            },
          });
        } catch (err) {
          console.error('[returns] customer return-requested email failed', primaryRow.publicId, err);
        }
      }
    }

    return buildReturnSubmission(created);
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
        actionUrl: `${config.frontend.customerUrl}/dashboard/returns/${rr.submissionPublicId || returnPublicId}`,
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
    if (rr.type === 'REFURBISHMENT') {
      throw new AppError(
        400,
        'Refurbishment returns use customer-provided USPS tracking. Generate labels are not used for this path.'
      );
    }
    if (!['APPROVED', 'LABEL_GENERATED'].includes(rr.status)) {
      throw new AppError(400, 'Return must be approved before generating a label');
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
    let rr = await prisma.returnRequest.findUnique({
      where: { publicId: returnPublicId },
      include: {
        user: { select: { email: true, firstName: true, lastName: true } },
        order: { select: { publicId: true } },
      },
    });
    if (!rr) {
      rr = await prisma.returnRequest.findFirst({
        where: {
          OR: [{ submissionPublicId: returnPublicId }, { returnNumber: returnPublicId }],
        },
        include: {
          user: { select: { email: true, firstName: true, lastName: true } },
          order: { select: { publicId: true } },
        },
        orderBy: { createdAt: 'asc' },
      });
    }
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
      if (notes === undefined && inspectionChecklist === undefined) return this.getById(returnPublicId);
      const updatedNotes = await prisma.returnRequest.update({
        where: { id: rr.id },
        data: {
          ...(notes !== undefined ? { notes: notes ? String(notes).trim() : null } : {}),
          ...(inspectionChecklist !== undefined ? { inspectionChecklistJson: inspectionChecklist } : {}),
        },
        include: returnInclude,
      });
      if (inspectionChecklist !== undefined) {
        await appendReturnActionNote(prisma, {
          returnRequestId: rr.id,
          status: rr.status,
          actorUserId: await resolveActorUserId(actor),
          note: 'Inspection checklist saved',
        });
      }
      await writeAdminAudit({
        actorId: actor?.id,
        actorEmail: actor?.email,
        action: inspectionChecklist !== undefined ? 'RETURN_CHECKLIST' : 'RETURN_NOTES',
        entityType: 'ReturnRequest',
        entityId: returnPublicId,
        meta: { notes: updatedNotes.notes, inspectionChecklist },
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

    if (
      rr.type === 'STANDARD' &&
      (status === 'APPROVED' || status === 'REJECTED') &&
      rr.status === 'UNDER_INSPECTION'
    ) {
      const checklist = inspectionChecklist ?? rr.inspectionChecklistJson;
      if (!checklistComplete(checklist)) {
        throw new AppError(400, 'Complete and save the inspection checklist before approving or rejecting');
      }
      if (status === 'REJECTED') {
        const reason = rejectionReason ? String(rejectionReason).trim() : '';
        if (!reason) throw new AppError(400, 'Rejection reason is required');
      }
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

    // Keep multi-item STANDARD submissions in sync on status transitions.
    const siblingIds =
      rr.type === 'STANDARD'
        ? (
            await prisma.returnRequest.findMany({
              where: { submissionPublicId: rr.submissionPublicId },
              select: { id: true, status: true, publicId: true },
            })
          )
            .filter((s) => s.status === rr.status)
            .map((s) => s.id)
        : [rr.id];

    const updated = await prisma.$transaction(async (tx) => {
      let primary = null;
      for (const sid of siblingIds) {
        const row = await tx.returnRequest.update({
          where: { id: sid },
          data,
          include: returnInclude,
        });
        await appendReturnStatusEvent(tx, {
          returnRequestId: sid,
          fromStatus: rr.status,
          toStatus: status,
          actorUserId,
          note: data.notes || data.rejectionReason || null,
        });
        if (sid === rr.id) primary = row;
      }
      return primary;
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
        for (const sid of siblingIds) {
          await markUnitsReturnedForReturn(tx, sid);
        }
      });
    }

    if (status === 'UNDER_INSPECTION') {
      try {
        notifyInspectionQueued(updated);
      } catch (err) {
        console.error('[returns] inspection queued notification failed', returnPublicId, err);
      }
    }

    // STANDARD approve no longer auto-refunds or auto-restocks (plan 39–41).

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
            actionUrl: `${config.frontend.customerUrl}/dashboard/returns/${rr.submissionPublicId || returnPublicId}`,
          },
        });
        return this.getById(returnPublicId);
      }
    }

    const emailNote =
      status === 'REJECTED' || status === 'INSPECTION_REJECTED'
        ? data.rejectionReason || 'See return details for more information.'
        : status === 'APPROVED' && rr.type === 'STANDARD'
          ? 'Your return was approved. Your refund will be processed next. Original shipping charges are not refunded.'
          : undefined;

    await emailService.sendTemplate({
      to: rr.user.email,
      template: 'return-status',
      context: {
        name: [rr.user.firstName, rr.user.lastName].filter(Boolean).join(' '),
        status,
        note: emailNote,
        actionUrl: `${config.frontend.customerUrl}/dashboard/returns/${rr.submissionPublicId || returnPublicId}`,
      },
    });

    return this.getById(returnPublicId);
  }

  /**
   * Process Stripe refunds for all APPROVED STANDARD lines in a submission (no auto on approve).
   */
  async processRefund(returnPublicId, actor) {
    const detail = await this.getById(returnPublicId);
    if (detail.type !== 'STANDARD') {
      throw new AppError(400, 'Refunds apply to standard returns only');
    }
    const items = detail.submissionItems?.length
      ? detail.submissionItems
      : [
          {
            id: detail.primaryItemId || detail.id,
            status: detail.status,
            stripeRefundId: detail.stripeRefundId,
          },
        ];

    const pending = items.filter((item) => item.status === 'APPROVED' && !item.stripeRefundId);
    if (!pending.length) {
      const alreadyDone = items.every((item) => item.stripeRefundId || item.refundAmount != null);
      if (alreadyDone) return this.getById(returnPublicId);
      throw new AppError(400, 'Return must be approved before processing a refund');
    }

    for (const item of pending) {
      const row = await prisma.returnRequest.findUnique({
        where: { publicId: item.id },
        select: { id: true, publicId: true, type: true, stripeRefundId: true, status: true },
      });
      if (!row) continue;
      try {
        await processStandardReturnRefund(row, actor);
      } catch (err) {
        if (err instanceof AppError && err.code === 'STRIPE_NOT_CONFIGURED') {
          // Dev without Stripe — leave refund fields null.
          continue;
        }
        throw err;
      }
    }
    return this.getById(returnPublicId);
  }

  async restockReturn(returnPublicId, body, actor) {
    const rr = await prisma.returnRequest.findFirst({
      where: {
        OR: [{ publicId: returnPublicId }, { submissionPublicId: returnPublicId }],
      },
      include: { orderItem: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!rr) throw new AppError(404, 'Return request not found');
    if (rr.type !== 'STANDARD') {
      throw new AppError(400, 'Restock applies to standard returns only');
    }

    const siblings = await prisma.returnRequest.findMany({
      where: { submissionPublicId: rr.submissionPublicId },
      include: { orderItem: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!siblings.every((s) => s.status === 'APPROVED')) {
      throw new AppError(400, 'Approve the return before restocking inventory');
    }

    const selections = Array.isArray(body?.items) ? body.items : null;
    const actorUserId = await resolveActorUserId(actor);

    await prisma.$transaction(async (tx) => {
      for (const sibling of siblings) {
        if (sibling.restockedAt) continue;
        let qty = Math.max(1, Number(sibling.quantity || 1));
        if (selections) {
          const sel = selections.find(
            (s) => s.returnItemId === sibling.publicId || s.id === sibling.publicId
          );
          if (!sel) continue;
          qty = Math.min(qty, Math.max(1, Number(sel.quantity ?? qty)));
        }
        if (!sibling.orderItem) continue;
        const product = await tx.product.findUnique({
          where: { id: sibling.orderItem.productId },
          include: { variants: { orderBy: { sortOrder: 'asc' } } },
        });
        if (!product) continue;
        await restockOrderLineStock(
          tx,
          product,
          sibling.orderItem.productVariantId,
          qty,
          {
            referenceType: 'return',
            referenceId: sibling.publicId,
            actorUserId,
            note: returnLedgerNote(
              'RESTOCK',
              sibling.returnNumber || sibling.publicId,
              sibling.type
            ),
          },
          'RESTOCK'
        );
        await tx.returnRequest.update({
          where: { id: sibling.id },
          data: { restockedAt: new Date(), restockedQuantity: qty },
        });
        await appendReturnActionNote(tx, {
          returnRequestId: sibling.id,
          status: sibling.status,
          actorUserId,
          note: `Restocked ${qty} unit${qty === 1 ? '' : 's'} to inventory`,
        });
      }
    });

    await writeAdminAudit({
      actorId: actor?.id,
      actorEmail: actor?.email,
      action: 'RETURN_RESTOCK',
      entityType: 'ReturnRequest',
      entityId: returnPublicId,
      meta: { items: selections },
    });

    return this.getById(returnPublicId);
  }

  async getPackageRequestForSubmission(rows) {
    const orderId = rows[0]?.orderId;
    const returnRequestId = rows[0]?.id;
    if (!orderId) return null;
    const linked = returnRequestId
      ? await prisma.returnPackageRequest.findFirst({
          where: {
            returnRequestId,
            status: { in: ['REQUESTED', 'APPROVED', 'SENT'] },
          },
          orderBy: { createdAt: 'desc' },
          select: {
            publicId: true,
            status: true,
            reason: true,
            comments: true,
            dispatchDate: true,
            uspsTrackingNumber: true,
            expectedDeliveryDate: true,
            adminNotes: true,
            createdAt: true,
            updatedAt: true,
          },
        })
      : null;
    if (linked) return linked;
    return prisma.returnPackageRequest.findFirst({
      where: {
        orderId,
        status: { in: ['REQUESTED', 'APPROVED', 'SENT'] },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        publicId: true,
        status: true,
        reason: true,
        comments: true,
        dispatchDate: true,
        uspsTrackingNumber: true,
        expectedDeliveryDate: true,
        adminNotes: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async submitCustomerUspsShipment(userPublicId, returnPublicId, { trackingNumber, note, shippedAt, photoUrl }) {
    const user = await prisma.user.findUnique({ where: { publicId: userPublicId }, select: { id: true } });
    if (!user) throw new AppError(401, 'Unauthorized');

    const rows = await this._loadUserSubmissionRows(user.id, returnPublicId);
    const primary = rows[0];
    if (primary.type !== 'REFURBISHMENT') throw new AppError(400, 'Only refurbishment returns accept USPS shipment details');
    if (!['APPROVED', 'LABEL_GENERATED'].includes(primary.status)) {
      throw new AppError(400, 'Return is not awaiting your shipment details');
    }

    const tracking = String(trackingNumber || '').trim();
    if (!tracking) throw new AppError(400, 'USPS tracking number is required');

    const shipped = shippedAt ? new Date(shippedAt) : new Date();
    const noteTrimmed = note ? String(note).trim() : null;
    const photo = photoUrl && String(photoUrl).startsWith('/uploads/returns/') ? String(photoUrl) : null;

    const receiveDeadline = refurbShipByDeadline(shipped);

    await prisma.$transaction(async (tx) => {
      for (const row of rows) {
        await tx.returnRequest.update({
          where: { id: row.id },
          data: {
            status: 'IN_TRANSIT',
            manualCarrier: 'USPS',
            manualTrackingNumber: tracking,
            manualShippedAt: shipped,
            customerShippingNote: noteTrimmed,
            customerShippingPhotoUrl: photo,
            customerShippingSubmittedAt: new Date(),
            shipByDeadline: receiveDeadline,
            keepWaitingUntil: null,
          },
        });
        await appendReturnStatusEvent(tx, {
          returnRequestId: row.id,
          fromStatus: row.status,
          toStatus: 'IN_TRANSIT',
          actorUserId: user.id,
          note: noteTrimmed ? `Customer shipped via USPS · ${noteTrimmed}` : 'Customer shipped via USPS',
        });
      }
    });

    return this.getForUser(userPublicId, returnPublicId);
  }

  async cancelByUser(userPublicId, returnPublicId, { reason } = {}) {
    const user = await prisma.user.findUnique({ where: { publicId: userPublicId }, select: { id: true } });
    if (!user) throw new AppError(401, 'Unauthorized');

    const rows = await this._loadUserSubmissionRows(user.id, returnPublicId);
    const primary = rows[0];
    if (!['APPROVED', 'ELIGIBILITY_REVIEW', 'REQUESTED'].includes(primary.status)) {
      throw new AppError(400, 'This return can no longer be cancelled online');
    }

    const note = reason ? String(reason).trim() : 'Cancelled by customer';

    await prisma.$transaction(async (tx) => {
      for (const row of rows) {
        await tx.returnRequest.update({
          where: { id: row.id },
          data: { status: 'CANCELLED', notes: note },
        });
        await appendReturnStatusEvent(tx, {
          returnRequestId: row.id,
          fromStatus: row.status,
          toStatus: 'CANCELLED',
          actorUserId: user.id,
          note,
        });
      }
    });

    return this.getForUser(userPublicId, returnPublicId);
  }

  async keepWaiting(returnPublicId, actor) {
    const rr = await prisma.returnRequest.findUnique({
      where: { publicId: returnPublicId },
    });
    if (!rr) throw new AppError(404, 'Return request not found');
    if (rr.type !== 'REFURBISHMENT') throw new AppError(400, 'Only refurbishment returns support keep waiting');
    if (!['APPROVED', 'IN_TRANSIT'].includes(rr.status)) {
      throw new AppError(400, 'Return is not in a shippable state');
    }

    const activeDeadline = rr.keepWaitingUntil || rr.shipByDeadline;
    if (!activeDeadline) {
      throw new AppError(400, 'Expected receive date is not set yet — waiting for customer USPS tracking or envelope dispatch');
    }
    if (new Date() <= new Date(activeDeadline)) {
      throw new AppError(400, 'Keep waiting is only available after the expected receive date has passed');
    }

    const actorUserId = await resolveActorUserId(actor);
    const submissionKey = rr.submissionPublicId || rr.publicId;
    const siblings = await prisma.returnRequest.findMany({
      where: { submissionPublicId: submissionKey },
      select: { id: true, status: true },
    });

    const extended = refurbShipByDeadline(rr.keepWaitingUntil || rr.shipByDeadline || new Date());

    await prisma.$transaction(async (tx) => {
      for (const row of siblings) {
        await tx.returnRequest.update({
          where: { id: row.id },
          data: { keepWaitingUntil: extended },
        });
        await appendReturnStatusEvent(tx, {
          returnRequestId: row.id,
          fromStatus: row.status,
          toStatus: row.status,
          actorUserId,
          note: `Keep waiting until ${extended.toLocaleDateString()}`,
        });
      }
    });

    await writeAdminAudit({
      actorId: actor?.id,
      actorEmail: actor?.email,
      action: 'RETURN_KEEP_WAITING',
      entityType: 'ReturnRequest',
      entityId: returnPublicId,
      meta: { keepWaitingUntil: extended.toISOString() },
    });

    return this.getById(returnPublicId);
  }

  async _loadUserSubmissionRows(userId, returnPublicId) {
    let rows = await prisma.returnRequest.findMany({
      where: {
        userId,
        OR: [
          { publicId: returnPublicId },
          { submissionPublicId: returnPublicId },
          { returnNumber: returnPublicId },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!rows.length) throw new AppError(404, 'Return request not found');
    if (rows.length === 1) {
      const key = returnSubmissionKey(rows[0]);
      if (key && key !== returnPublicId) {
        rows = await prisma.returnRequest.findMany({
          where: { userId, submissionPublicId: key },
          orderBy: { createdAt: 'asc' },
        });
      }
    }
    return rows;
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
