import { PrismaClient } from '@prisma/client';
import { AppError } from '../utils/error-handler.js';
import { emailService } from './email.service.js';
import { config } from '../config/env.js';
import { writeAdminAudit } from './audit.service.js';

const prisma = new PrismaClient();

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
        order: { select: { publicId: true, status: true, createdAt: true } },
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
        order: { select: { publicId: true, status: true, createdAt: true } },
        orderItem: { include: { product: { select: { name: true, productType: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
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

    const orderItem = payload.orderItemId
      ? order.orderItems.find((i) => i.publicId === payload.orderItemId)
      : order.orderItems[0];
    if (!orderItem) throw new AppError(404, 'Order item not found');

    if (payload.type === 'REFURBISHMENT') {
      const hasAccess = Boolean(user.accessMemberUntil && user.accessMemberUntil > new Date());
      if (!hasAccess) throw new AppError(403, 'ACCESS membership required for refurbishment returns');
    }

    if (payload.type === 'STANDARD') {
      const ageDays = (Date.now() - new Date(order.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      if (ageDays > 14) throw new AppError(400, 'Standard return window (14 days) has passed');
    }

    return prisma.returnRequest.create({
      data: {
        userId: user.id,
        orderId: order.id,
        orderItemId: orderItem.id,
        type: payload.type,
        reason: payload.reason,
        status: 'REQUESTED',
      },
    });
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

    if (status === 'APPROVED' && rr.type === 'REFURBISHMENT') {
      try {
        const wallet = await prisma.storeCreditWallet.upsert({
          where: { userId: rr.userId },
          update: {},
          create: { userId: rr.userId, balance: 0 },
        });
        const amount = 10; // 20% of $50 ACCESS membership.
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
