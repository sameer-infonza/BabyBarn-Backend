import { prisma } from '../lib/prisma.js';
import { config } from '../config/env.js';
import { AppError } from '../utils/error-handler.js';
import { writeAdminAudit } from './audit.service.js';
import { emailService } from './email.service.js';
import { getBusinessSettings } from './admin.service.js';
import { restockOrderLineStock } from './inventory-reservation.js';
import { refurbishmentService } from './refurbishment.service.js';
import { markUnitsReturnedForReturn } from './product-unit.service.js';

function isMissingWalletTableError(error) {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error.code === 'P2021' || error.code === 'P2022')
  );
}

export class ReturnsService {
  validateTransition(current, next) {
    const allowed = {
      REQUESTED: ['RECEIVED', 'UNDER_INSPECTION', 'APPROVED', 'REJECTED'],
      RECEIVED: ['UNDER_INSPECTION', 'APPROVED', 'REJECTED'],
      UNDER_INSPECTION: ['APPROVED', 'REJECTED'],
      APPROVED: [],
      REJECTED: [],
    };
    return (allowed[current] || []).includes(next);
  }

  async listAll() {
    return prisma.returnRequest.findMany({
      include: {
        user: { select: { publicId: true, email: true, firstName: true, lastName: true } },
        order: { select: { publicId: true, orderNumber: true, status: true, createdAt: true } },
        orderItem: { include: { product: { select: { name: true, productType: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listForUser(userPublicId) {
    const user = await prisma.user.findUnique({ where: { publicId: userPublicId }, select: { id: true } });
    if (!user) throw new AppError(401, 'Unauthorized');
    return prisma.returnRequest.findMany({
      where: { userId: user.id },
      include: {
        order: { select: { publicId: true, orderNumber: true, status: true, createdAt: true } },
        orderItem: { include: { product: { select: { name: true, productType: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getForUser(userPublicId, returnPublicId) {
    const user = await prisma.user.findUnique({ where: { publicId: userPublicId }, select: { id: true } });
    if (!user) throw new AppError(401, 'Unauthorized');
    const row = await prisma.returnRequest.findUnique({
      where: { publicId: returnPublicId },
      include: {
        order: { select: { publicId: true, orderNumber: true, status: true, createdAt: true } },
        orderItem: { include: { product: { select: { name: true, productType: true } } } },
      },
    });
    if (!row || row.userId !== user.id) throw new AppError(404, 'Return request not found');
    return row;
  }

  async getById(returnPublicId) {
    const row = await prisma.returnRequest.findUnique({
      where: { publicId: returnPublicId },
      include: {
        user: { select: { publicId: true, email: true, firstName: true, lastName: true } },
        order: { select: { publicId: true, orderNumber: true, status: true, createdAt: true } },
        orderItem: { include: { product: { select: { name: true, productType: true } } } },
      },
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
    }

    if (payload.type === 'STANDARD') {
      const ageDays = (Date.now() - new Date(order.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      if (ageDays > 14) throw new AppError(400, 'Standard return window (14 days) has passed');
    }

    const existing = await prisma.returnRequest.findMany({
      where: {
        orderId: order.id,
        orderItem: { publicId: { in: itemPublicIds } },
        status: { notIn: ['REJECTED'] },
      },
      select: { orderItem: { select: { publicId: true } } },
    });
    const blocked = new Set(existing.map((r) => r.orderItem?.publicId).filter(Boolean));
    const pendingIds = itemPublicIds.filter((id) => !blocked.has(id));
    if (pendingIds.length === 0) {
      throw new AppError(400, 'Selected items already have an open return request');
    }

    const created = await prisma.$transaction(
      pendingIds.map((publicId) => {
        const orderItem = order.orderItems.find((i) => i.publicId === publicId);
        if (!orderItem) throw new AppError(404, 'Order item not found');
        return prisma.returnRequest.create({
          data: {
            userId: user.id,
            orderId: order.id,
            orderItemId: orderItem.id,
            type: payload.type,
            reason: payload.reason,
            status: 'REQUESTED',
          },
          include: {
            order: { select: { publicId: true, orderNumber: true, status: true, createdAt: true } },
            orderItem: { include: { product: { select: { name: true, productType: true } } } },
          },
        });
      })
    );

    return created.length === 1 ? created[0] : created;
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
      if (notes === undefined) {
        return rr;
      }
      const updatedNotes = await prisma.returnRequest.update({
        where: { id: rr.id },
        data: { notes: notes ? String(notes).trim() : null },
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

    if (!this.validateTransition(rr.status, status)) {
      throw new AppError(400, `Invalid return status transition: ${rr.status} -> ${status}`);
    }

    const data = { status };
    if (notes !== undefined) {
      data.notes = notes ? String(notes).trim() : null;
    }

    const updated = await prisma.returnRequest.update({
      where: { id: rr.id },
      data,
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
              1,
              { referenceType: 'return', referenceId: returnPublicId, note: 'Standard return approved' },
              'RESTOCK'
            );
          }
        });
      }
    }

    if (status === 'APPROVED' && rr.type === 'REFURBISHMENT') {
      await refurbishmentService.createJobForReturn(rr.id);
      try {
        const wallet = await prisma.storeCreditWallet.upsert({
          where: { userId: rr.userId },
          update: {},
          create: { userId: rr.userId, balance: 0, heldBalance: 0 },
        });
        let itemAccessPrice = 0;
        if (rr.orderItemId) {
          const line = await prisma.orderItem.findUnique({
            where: { id: rr.orderItemId },
            select: { price: true },
          });
          itemAccessPrice = Number(line?.price ?? 0);
        }
        if (itemAccessPrice <= 0) {
          const settings = await getBusinessSettings();
          itemAccessPrice = Number(settings.accessMembershipPriceUsd ?? 50);
        }
        const amount = Math.round(itemAccessPrice * 0.2 * 100) / 100;
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
      } catch (error) {
        if (!isMissingWalletTableError(error)) {
          throw error;
        }
      }
    }

    await emailService.sendTemplate({
      to: rr.user.email,
      template: 'return-status',
      context: {
        name: [rr.user.firstName, rr.user.lastName].filter(Boolean).join(' '),
        status,
        actionUrl: `${config.frontend.customerUrl}/dashboard/returns`,
      },
    });

    return updated;
  }
}

export const returnsService = new ReturnsService();
