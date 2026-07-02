import { prisma } from '../lib/prisma.js';
import { AppError } from '../utils/error-handler.js';
import { isValidRouteModule } from '../constants/admin-modules.js';
import { userCanSeeModule } from '../lib/admin-module-access.js';
import { config } from '../config/env.js';
import { emailService } from './email.service.js';
import { resolveAdminNotificationRecipients } from './admin-notification-recipients.service.js';

export { userCanSeeModule };

/** Hours to suppress duplicate notifications for the same type + entity. */
const DEDUPE_HOURS_BY_TYPE = {
  NEW_ORDER: 24,
  RETURN_REQUEST: 24,
  LOW_STOCK: 24,
  CANCELLATION_REVIEW: 24,
  INSPECTION_QUEUED: 24,
  ACCESS_EXPIRING: 168,
};

export function assertValidAdminNotificationModule(module) {
  if (!isValidRouteModule(module)) {
    throw new AppError(500, `Invalid notification module: ${String(module)}`);
  }
}

function serializeNotification(row, readAt) {
  return {
    id: row.publicId,
    type: row.type,
    title: row.title,
    body: row.body,
    href: row.href,
    entityType: row.entityType,
    entityId: row.entityId,
    module: row.module,
    createdAt: row.createdAt.toISOString(),
    readAt: readAt ? readAt.toISOString() : null,
    isRead: Boolean(readAt),
  };
}

async function resolveInternalUserId(user) {
  if (!user?.id) return null;
  const row = await prisma.user.findUnique({
    where: { publicId: user.id },
    select: { id: true },
  });
  return row?.id ?? null;
}

function adminActionUrl(href) {
  const base = String(config.frontend.adminUrl || '').replace(/\/$/, '');
  const path = href.startsWith('/') ? href : `/${href}`;
  return `${base}${path}`;
}

function fireAdminOperationalEmail({ prefKey, module, template, context, href }) {
  void (async () => {
    try {
      const recipients = await resolveAdminNotificationRecipients({ module, prefKey });
      if (!recipients.length) return;

      const actionUrl = href ? adminActionUrl(href) : context.actionUrl;
      const enriched = { ...context, actionUrl: actionUrl || context.actionUrl };

      const results = await Promise.allSettled(
        recipients.map((recipient) =>
          emailService.sendTemplate({
            to: recipient.email,
            template,
            context: { name: recipient.name, ...enriched },
          })
        )
      );

      for (const result of results) {
        if (result.status === 'rejected') {
          console.error('[admin-notification] email send failed', template, result.reason);
        }
      }
    } catch (err) {
      console.error('[admin-notification] email dispatch failed', template, err);
    }
  })();
}

export class AdminNotificationService {
  async createAdminNotification({
    type,
    title,
    body,
    href,
    entityType,
    entityId,
    module,
  }) {
    assertValidAdminNotificationModule(module);
    const dedupeHours = DEDUPE_HOURS_BY_TYPE[type] ?? 24;
    const since = new Date(Date.now() - dedupeHours * 60 * 60 * 1000);
    const existing = await prisma.adminNotification.findFirst({
      where: {
        type,
        entityId: String(entityId),
        createdAt: { gte: since },
      },
      select: { publicId: true },
    });
    if (existing) return existing;

    return prisma.adminNotification.create({
      data: {
        type,
        title: String(title),
        body: String(body),
        href: String(href),
        entityType: String(entityType),
        entityId: String(entityId),
        module: String(module),
      },
    });
  }

  async listForUser(user, { page = 1, limit = 20, unreadOnly = false } = {}) {
    const userId = await resolveInternalUserId(user);
    if (!userId) throw new AppError(401, 'Unauthorized');

    const take = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const skip = (Math.max(Number(page) || 1, 1) - 1) * take;

    const allRows = await prisma.adminNotification.findMany({
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: {
        reads: {
          where: { userId },
          select: { readAt: true },
        },
      },
    });

    const visible = allRows.filter((row) => userCanSeeModule(user, row.module));

    const filtered = unreadOnly
      ? visible.filter((row) => row.reads.length === 0)
      : visible;

    const slice = filtered.slice(skip, skip + take);
    const unreadCount = visible.filter((row) => row.reads.length === 0).length;

    return {
      items: slice.map((row) => serializeNotification(row, row.reads[0]?.readAt ?? null)),
      pagination: {
        page: Math.max(Number(page) || 1, 1),
        limit: take,
        total: filtered.length,
      },
      unreadCount,
    };
  }

  async unreadCountForUser(user) {
    const { unreadCount } = await this.listForUser(user, { page: 1, limit: 1, unreadOnly: false });
    return unreadCount;
  }

  async getRecentForUser(user, limit = 8) {
    const { items } = await this.listForUser(user, { page: 1, limit, unreadOnly: false });
    return items;
  }

  async markRead(user, notificationPublicId) {
    const userId = await resolveInternalUserId(user);
    if (!userId) throw new AppError(401, 'Unauthorized');

    const notification = await prisma.adminNotification.findUnique({
      where: { publicId: notificationPublicId },
    });
    if (!notification) throw new AppError(404, 'Notification not found');
    if (!userCanSeeModule(user, notification.module)) {
      throw new AppError(403, 'Forbidden');
    }

    await prisma.adminNotificationRead.upsert({
      where: {
        userId_notificationId: {
          userId,
          notificationId: notification.id,
        },
      },
      create: {
        userId,
        notificationId: notification.id,
      },
      update: {
        readAt: new Date(),
      },
    });

    return { ok: true };
  }

  async markAllRead(user) {
    const userId = await resolveInternalUserId(user);
    if (!userId) throw new AppError(401, 'Unauthorized');

    const allRows = await prisma.adminNotification.findMany({
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: {
        reads: {
          where: { userId },
          select: { id: true },
        },
      },
    });

    const unreadIds = allRows
      .filter((row) => userCanSeeModule(user, row.module) && row.reads.length === 0)
      .map((row) => row.id);

    if (unreadIds.length === 0) return { marked: 0 };

    await prisma.adminNotificationRead.createMany({
      data: unreadIds.map((notificationId) => ({ userId, notificationId })),
      skipDuplicates: true,
    });

    return { marked: unreadIds.length };
  }
}

export const adminNotificationService = new AdminNotificationService();

/** Fire-and-forget helper for event hooks. */
export function notifyAdmin(payload) {
  void adminNotificationService.createAdminNotification(payload).catch((err) => {
    console.error('[admin-notification] create failed', payload?.type, err);
  });
}

function formatOrderLabel(order) {
  if (order?.orderNumber) return `#${order.orderNumber}`;
  if (order?.publicId) return order.publicId.slice(0, 8);
  return 'Order';
}

function returnCustomerEmail(returnRow) {
  return returnRow.order?.user?.email || returnRow.user?.email || 'Customer';
}

function returnOrderLabel(returnRow) {
  return returnRow.order?.orderNumber
    ? `#${returnRow.order.orderNumber}`
    : returnRow.order?.publicId?.slice(0, 8) || 'order';
}

function returnDetailHref(returnRow) {
  return returnRow.type === 'REFURBISHMENT'
    ? `/admin/inspection/${returnRow.publicId}`
    : `/admin/returns/${returnRow.publicId}`;
}

function returnNotifyModule(returnRow) {
  return returnRow.type === 'REFURBISHMENT' ? 'inspection' : 'returns';
}

export function notifyNewPaidOrder(order) {
  if (!order?.publicId) return;
  const label = formatOrderLabel(order);
  const amount =
    order.totalAmount != null && Number.isFinite(Number(order.totalAmount))
      ? `$${Number(order.totalAmount).toFixed(2)}`
      : null;
  const href = `/admin/orders/${order.publicId}`;
  notifyAdmin({
    type: 'NEW_ORDER',
    title: `New order ${label}`,
    body: amount ? `Paid order ${amount} — review and fulfill.` : 'New paid order — review and fulfill.',
    href,
    entityType: 'Order',
    entityId: order.publicId,
    module: 'orders',
  });
  fireAdminOperationalEmail({
    prefKey: 'newOrders',
    module: 'orders',
    template: 'admin-new-order',
    href,
    context: {
      orderNumber: order.orderNumber || order.publicId,
      amount,
      customerEmail: order.user?.email || order.contactEmail,
    },
  });
}

export function notifyReturnRequest(returnRow) {
  if (!returnRow?.publicId) return;
  const orderLabel = returnOrderLabel(returnRow);
  const typeLabel = returnRow.type === 'REFURBISHMENT' ? 'Refurb return' : 'Return';
  const module = returnNotifyModule(returnRow);
  const href = returnDetailHref(returnRow);
  notifyAdmin({
    type: 'RETURN_REQUEST',
    title: `${typeLabel} submitted`,
    body: `Customer requested a return for order ${orderLabel}.`,
    href,
    entityType: 'ReturnRequest',
    entityId: returnRow.publicId,
    module,
  });
  fireAdminOperationalEmail({
    prefKey: 'returnRequests',
    module,
    template: 'admin-return-request',
    href,
    context: {
      returnType: typeLabel,
      orderNumber: orderLabel,
      customerEmail: returnCustomerEmail(returnRow),
      reason: returnRow.reason,
    },
  });
}

export function notifyEligibilityReview(returnRow) {
  if (!returnRow?.publicId) return;
  const orderLabel = returnOrderLabel(returnRow);
  const href = `/admin/inspection/${returnRow.publicId}`;
  notifyAdmin({
    type: 'RETURN_REQUEST',
    title: 'Eligibility review needed',
    body: `Refurb return for order ${orderLabel} requires manual eligibility review.`,
    href,
    entityType: 'ReturnRequest',
    entityId: `${returnRow.publicId}:eligibility`,
    module: 'inspection',
  });
  fireAdminOperationalEmail({
    prefKey: 'returnRequests',
    module: 'inspection',
    template: 'admin-eligibility-review',
    href,
    context: {
      orderNumber: orderLabel,
      customerEmail: returnCustomerEmail(returnRow),
    },
  });
}

export function notifyInspectionQueued(returnRow) {
  if (!returnRow?.publicId) return;
  const href = `/admin/inspection/${returnRow.publicId}`;
  notifyAdmin({
    type: 'INSPECTION_QUEUED',
    title: 'Return ready for inspection',
    body: 'A refurbishment return is queued in the inspection workflow.',
    href,
    entityType: 'ReturnRequest',
    entityId: returnRow.publicId,
    module: 'inspection',
  });
  fireAdminOperationalEmail({
    prefKey: 'returnRequests',
    module: 'inspection',
    template: 'admin-inspection-queued',
    href,
    context: {
      orderNumber: returnOrderLabel(returnRow),
      customerEmail: returnCustomerEmail(returnRow),
    },
  });
}

export function notifyReturnPackageRequest(packageRow) {
  if (!packageRow?.publicId) return;
  const orderLabel = packageRow.order?.orderNumber
    ? `#${packageRow.order.orderNumber}`
    : packageRow.order?.publicId?.slice(0, 8) || 'order';
  const href = '/admin/returns';
  notifyAdmin({
    type: 'RETURN_REQUEST',
    title: 'Prepaid return package requested',
    body: `Customer requested a prepaid return package for order ${orderLabel}.`,
    href,
    entityType: 'ReturnPackageRequest',
    entityId: packageRow.publicId,
    module: 'returns',
  });
  fireAdminOperationalEmail({
    prefKey: 'returnRequests',
    module: 'returns',
    template: 'admin-return-package-request',
    href,
    context: {
      orderNumber: orderLabel,
      customerEmail: packageRow.user?.email,
      reason: packageRow.reason,
    },
  });
}

export function notifyCancellationReview(order) {
  if (!order?.publicId) return;
  const label = formatOrderLabel(order);
  const href = `/admin/orders/${order.publicId}`;
  notifyAdmin({
    type: 'CANCELLATION_REVIEW',
    title: 'Cancellation review needed',
    body: `Customer requested cancellation for order ${label}.`,
    href,
    entityType: 'Order',
    entityId: order.publicId,
    module: 'orders',
  });
  fireAdminOperationalEmail({
    prefKey: 'newOrders',
    module: 'orders',
    template: 'admin-cancellation-review',
    href,
    context: {
      orderNumber: label,
      customerEmail: order.user?.email || order.contactEmail,
    },
  });
}

export function notifyLowStock(product, available) {
  if (!product?.publicId) return;
  const sku = product.sku ? ` (${product.sku})` : '';
  const href = '/admin/inventory?stockStatus=low_stock';
  notifyAdmin({
    type: 'LOW_STOCK',
    title: 'Low stock alert',
    body: `${product.name}${sku} — ${available} unit${available === 1 ? '' : 's'} available.`,
    href,
    entityType: 'Product',
    entityId: product.publicId,
    module: 'inventory',
  });
  fireAdminOperationalEmail({
    prefKey: 'lowStockAlerts',
    module: 'inventory',
    template: 'admin-low-stock',
    href,
    context: {
      productName: product.name,
      sku: product.sku,
      available,
    },
  });
}
