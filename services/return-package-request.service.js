import { prisma } from '../lib/prisma.js';
import { AppError } from '../utils/error-handler.js';
import { writeAdminAudit } from './audit.service.js';
import { notifyReturnPackageRequest } from './admin-notification.service.js';
import { emailService } from './email.service.js';
import { config } from '../config/env.js';
import { refurbShipByDeadline } from '../config/refurb.config.js';

const packageInclude = {
  user: { select: { publicId: true, email: true, firstName: true, lastName: true } },
  order: { select: { publicId: true, orderNumber: true, returnEnvelopeUsed: true } },
  returnRequest: {
    select: { publicId: true, submissionPublicId: true, returnNumber: true },
  },
};

export class ReturnPackageRequestService {
  async createForUser(userPublicId, { orderId, reason, comments, returnRequestId }) {
    const user = await prisma.user.findUnique({ where: { publicId: userPublicId }, select: { id: true } });
    if (!user) throw new AppError(401, 'Unauthorized');

    const order = await prisma.order.findUnique({
      where: { publicId: orderId },
      select: { id: true, publicId: true, userId: true, returnEnvelopeUsed: true },
    });
    if (!order || order.userId !== user.id) throw new AppError(404, 'Order not found');

    if (!returnRequestId && !order.returnEnvelopeUsed) {
      throw new AppError(
        400,
        'A replacement prepaid package is only available after the original prepaid return envelope for this order has been used.'
      );
    }

    let linkedReturnId = null;
    if (returnRequestId) {
      const rr = await prisma.returnRequest.findFirst({
        where: {
          OR: [
            { publicId: returnRequestId },
            { submissionPublicId: returnRequestId },
            { returnNumber: returnRequestId },
          ],
          userId: user.id,
          orderId: order.id,
          type: 'REFURBISHMENT',
        },
        select: { id: true },
      });
      if (!rr) throw new AppError(400, 'Return request not found for this order');
      linkedReturnId = rr.id;
    }

    const open = await prisma.returnPackageRequest.findFirst({
      where: {
        orderId: order.id,
        status: { in: ['REQUESTED', 'APPROVED'] },
      },
    });
    if (open) {
      throw new AppError(400, 'This order already has an open prepaid package request');
    }

    const created = await prisma.returnPackageRequest.create({
      data: {
        userId: user.id,
        orderId: order.id,
        returnRequestId: linkedReturnId,
        reason: String(reason).trim(),
        comments: comments ? String(comments).trim() : null,
      },
      include: packageInclude,
    });

    try {
      notifyReturnPackageRequest(created);
    } catch (err) {
      console.error('[return-package-request] admin notification failed', created.publicId, err);
    }

    return created;
  }

  async listForAdmin(filters = {}) {
    const where = {};
    if (filters.status) where.status = filters.status;
    return prisma.returnPackageRequest.findMany({
      where,
      include: packageInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  async listForUser(userPublicId) {
    const user = await prisma.user.findUnique({ where: { publicId: userPublicId }, select: { id: true } });
    if (!user) throw new AppError(401, 'Unauthorized');
    return prisma.returnPackageRequest.findMany({
      where: { userId: user.id },
      include: packageInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateStatus(publicId, { status, adminNotes, dispatchDate, uspsTrackingNumber, expectedDeliveryDate }, actor) {
    const row = await prisma.returnPackageRequest.findUnique({
      where: { publicId },
      include: { user: { select: { email: true, firstName: true, lastName: true } }, order: true },
    });
    if (!row) throw new AppError(404, 'Package request not found');

    const data = { status };
    if (adminNotes !== undefined) data.adminNotes = adminNotes ? String(adminNotes).trim() : null;
    if (dispatchDate !== undefined) data.dispatchDate = dispatchDate ? new Date(dispatchDate) : null;
    else if (status === 'SENT' && !row.dispatchDate) data.dispatchDate = new Date();
    if (expectedDeliveryDate !== undefined) {
      data.expectedDeliveryDate = expectedDeliveryDate ? new Date(expectedDeliveryDate) : null;
    }
    if (uspsTrackingNumber !== undefined) {
      data.uspsTrackingNumber = uspsTrackingNumber ? String(uspsTrackingNumber).trim() : null;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const pkg = await tx.returnPackageRequest.update({
        where: { id: row.id },
        data,
        include: packageInclude,
      });

      if (status === 'SENT' && row.returnRequestId) {
        const anchor = data.dispatchDate || new Date();
        const receiveDeadline = refurbShipByDeadline(anchor);
        const linked = await tx.returnRequest.findUnique({
          where: { id: row.returnRequestId },
          select: { submissionPublicId: true, publicId: true },
        });
        const submissionKey = linked?.submissionPublicId || linked?.publicId;
        const siblingWhere = submissionKey
          ? { submissionPublicId: submissionKey }
          : { id: row.returnRequestId };
        await tx.returnRequest.updateMany({
          where: siblingWhere,
          data: { shipByDeadline: receiveDeadline, keepWaitingUntil: null },
        });
      }

      return pkg;
    });

    await writeAdminAudit({
      actorId: actor?.id,
      actorEmail: actor?.email,
      action: 'RETURN_PACKAGE_REQUEST_STATUS',
      entityType: 'ReturnPackageRequest',
      entityId: publicId,
      meta: { from: row.status, to: status },
    });

    if (row.user?.email && (status === 'APPROVED' || status === 'SENT')) {
      await emailService.sendTemplate({
        to: row.user.email,
        template: 'return-package-request',
        context: {
          name: [row.user.firstName, row.user.lastName].filter(Boolean).join(' '),
          status,
          trackingNumber: updated.uspsTrackingNumber || '',
          actionUrl: `${config.frontend.customerUrl}/dashboard/orders`,
        },
      });
    }

    return updated;
  }
}

export const returnPackageRequestService = new ReturnPackageRequestService();
