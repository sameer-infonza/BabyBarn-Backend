import { prisma } from '../lib/prisma.js';
import { AppError } from '../utils/error-handler.js';
import { writeAdminAudit } from './audit.service.js';
import { slugifyName } from '../utils/slug.js';

const TRANSITIONS = {
  RECEIVED: ['INSPECTION', 'CANCELLED'],
  INSPECTION: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['QA_APPROVED', 'CANCELLED'],
  QA_APPROVED: ['LISTED', 'CANCELLED'],
  LISTED: [],
  CANCELLED: [],
};

export class RefurbishmentService {
  validateTransition(current, next) {
    return (TRANSITIONS[current] || []).includes(next);
  }

  async getByReturnPublicId(returnPublicId) {
    const rr = await prisma.returnRequest.findUnique({
      where: { publicId: returnPublicId },
      select: { id: true },
    });
    if (!rr) throw new AppError(404, 'Return not found');
    return prisma.refurbishmentJob.findUnique({
      where: { returnRequestId: rr.id },
      include: {
        returnRequest: {
          include: {
            orderItem: { include: { product: true } },
            user: { select: { email: true, firstName: true, lastName: true } },
          },
        },
        listedProduct: { select: { publicId: true, name: true, slug: true, stock: true } },
      },
    });
  }

  async listJobs({ status, page = 1, limit = 24 }) {
    const skip = (page - 1) * limit;
    const where = status && status !== 'all' ? { status } : {};
    const [rows, total] = await Promise.all([
      prisma.refurbishmentJob.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        include: {
          returnRequest: {
            include: {
              orderItem: { include: { product: { select: { name: true } } } },
              user: { select: { email: true, firstName: true, lastName: true } },
            },
          },
          listedProduct: { select: { publicId: true, name: true } },
        },
      }),
      prisma.refurbishmentJob.count({ where }),
    ]);
    return {
      jobs: rows,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) || 1 },
    };
  }

  async createJobForReturn(returnRequestId) {
    const existing = await prisma.refurbishmentJob.findUnique({ where: { returnRequestId } });
    if (existing) return existing;
    return prisma.refurbishmentJob.create({
      data: { returnRequestId, status: 'RECEIVED' },
    });
  }

  async updateStatus(jobPublicId, nextStatus, actor, opts = {}) {
    const job = await prisma.refurbishmentJob.findUnique({
      where: { publicId: jobPublicId },
      include: {
        returnRequest: {
          include: {
            orderItem: { include: { product: true } },
            user: true,
          },
        },
      },
    });
    if (!job) throw new AppError(404, 'Refurbishment job not found');
    if (!this.validateTransition(job.status, nextStatus)) {
      throw new AppError(400, `Invalid transition: ${job.status} -> ${nextStatus}`);
    }

    const data = { status: nextStatus };
    const now = new Date();
    if (nextStatus === 'INSPECTION') data.inspectedAt = now;
    if (nextStatus === 'IN_PROGRESS') data.refurbishedAt = now;
    if (opts.notes !== undefined) data.notes = opts.notes ? String(opts.notes).trim() : null;

    if (nextStatus === 'LISTED') {
      const listedProduct = await this.createListedRefurbProduct(job);
      data.listedAt = now;
      data.listedProductId = listedProduct.id;
    }

    const updated = await prisma.refurbishmentJob.update({
      where: { id: job.id },
      data,
      include: { listedProduct: true },
    });

    await writeAdminAudit({
      actorId: actor?.id,
      actorEmail: actor?.email,
      action: 'REFURB_JOB_STATUS',
      entityType: 'RefurbishmentJob',
      entityId: jobPublicId,
      meta: { from: job.status, to: nextStatus },
    });

    return { job: updated, listedProduct: updated.listedProduct };
  }

  async createListedRefurbProduct(job) {
    const line = job.returnRequest.orderItem;
    const source = line?.product;
    if (!source) throw new AppError(400, 'Return has no product line to list');

    const baseName = `${source.name} (Refurbished)`;
    const slugBase = slugifyName(baseName);

    return prisma.$transaction(async (tx) => {
      const { ensureUniqueSlug } = await import('./product.service.js');
      const slug = await ensureUniqueSlug(tx, `${slugBase}-${job.publicId.slice(-6)}`);
      const sku = `REF-${job.returnRequest.publicId.slice(-8).toUpperCase()}`;

      const category = await tx.category.findFirst({ where: { isActive: true }, select: { id: true } });
      if (!category) throw new AppError(500, 'No active category for refurbished listing');

      const product = await tx.product.create({
        data: {
          name: baseName,
          slug,
          sku,
          description: source.description,
          price: Math.round(Number(line.price || source.price) * 0.85 * 100) / 100,
          stock: 1,
          reservedStock: 0,
          categoryId: category.id,
          imageUrl: source.imageUrl,
          productType: 'REFURBISHED',
          isDraft: false,
          isActiveListing: true,
          sourceReturnId: job.returnRequestId,
        },
      });

      const { writeInventoryLedger } = await import('./inventory-ledger.service.js');
      await writeInventoryLedger(tx, {
        productId: product.id,
        productVariantId: null,
        quantityDelta: 1,
        eventType: 'RESTOCK',
        referenceType: 'refurbishment_job',
        referenceId: job.publicId,
        note: 'Refurbished unit listed',
      });

      const units = await tx.productUnit.findMany({
        where: { sourceReturnId: job.returnRequestId },
      });
      for (const unit of units) {
        await tx.productUnit.update({
          where: { id: unit.id },
          data: {
            status: 'AVAILABLE_REFURB',
            productId: product.id,
            relistedAt: new Date(),
          },
        });
        await tx.productUnitEvent.create({
          data: {
            unitId: unit.id,
            fromStatus: unit.status,
            toStatus: 'AVAILABLE_REFURB',
            note: 'Listed as refurbished SKU',
          },
        });
      }

      return product;
    });
  }
}

export const refurbishmentService = new RefurbishmentService();
