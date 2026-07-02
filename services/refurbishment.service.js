import { prisma } from '../lib/prisma.js';
import { AppError } from '../utils/error-handler.js';
import { writeAdminAudit } from './audit.service.js';
import { slugifyName } from '../utils/slug.js';
import { resolveActorUserId } from '../lib/resolve-actor-user-id.js';

const TRANSITIONS = {
  RECEIVED: ['INSPECTION', 'CANCELLED'],
  INSPECTION: ['CLEANING', 'IN_PROGRESS', 'CANCELLED'],
  CLEANING: ['IRONING', 'REPAIR', 'IN_PROGRESS', 'CANCELLED'],
  IRONING: ['REPAIR', 'IN_PROGRESS', 'QA_APPROVED', 'CANCELLED'],
  REPAIR: ['IN_PROGRESS', 'QA_APPROVED', 'CANCELLED'],
  IN_PROGRESS: ['QA_APPROVED', 'CANCELLED'],
  QA_APPROVED: ['LISTED', 'CANCELLED'],
  LISTED: [],
  CANCELLED: [],
};

function refurbPriceFrom(amount) {
  if (amount == null || Number.isNaN(Number(amount))) return null;
  return Math.round(Number(amount) * 0.85 * 100) / 100;
}

function refurbVariantSku(sourceVariantSku) {
  return `${sourceVariantSku}-RF`;
}

function findRefurbVariantForSource(refurbVariants, sourceVariant) {
  const bySku = refurbVariants.find((rv) => rv.sku === refurbVariantSku(sourceVariant.sku));
  if (bySku) return bySku;
  const combo = JSON.stringify(sourceVariant.combination ?? {});
  return refurbVariants.find((rv) => JSON.stringify(rv.combination ?? {}) === combo);
}

const UNIT_STATUS_BY_JOB = {
  INSPECTION: 'INSPECTION',
  CLEANING: 'REFURBISHING',
  IRONING: 'REFURBISHING',
  REPAIR: 'REFURBISHING',
  IN_PROGRESS: 'REFURBISHING',
  QA_APPROVED: 'QA_HOLD',
  LISTED: 'AVAILABLE_REFURB',
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
            inspectionRecords: { orderBy: { createdAt: 'desc' }, take: 5 },
          },
        },
        listedProduct: {
          select: {
            publicId: true,
            name: true,
            slug: true,
            stock: true,
            sku: true,
            conditionGrade: true,
            sourceProductId: true,
          },
        },
        inspectionRecords: { orderBy: { createdAt: 'desc' }, take: 10 },
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
              orderItem: { include: { product: { select: { name: true, sku: true, publicId: true } } } },
              user: { select: { email: true, firstName: true, lastName: true } },
            },
          },
          listedProduct: { select: { publicId: true, name: true, sku: true, stock: true } },
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

  async transitionUnitsForJob(job, nextStatus) {
    const unitStatus = UNIT_STATUS_BY_JOB[nextStatus];
    if (!unitStatus) return;
    const units = await prisma.productUnit.findMany({
      where: { sourceReturnId: job.returnRequestId },
    });
    for (const unit of units) {
      if (unit.status === unitStatus) continue;
      await prisma.productUnit.update({
        where: { id: unit.id },
        data: {
          status: unitStatus,
          inspectedAt: nextStatus === 'INSPECTION' ? new Date() : unit.inspectedAt,
          refurbishedAt: ['CLEANING', 'IRONING', 'REPAIR', 'IN_PROGRESS'].includes(nextStatus)
            ? new Date()
            : unit.refurbishedAt,
          relistedAt: nextStatus === 'LISTED' ? new Date() : unit.relistedAt,
        },
      });
      await prisma.productUnitEvent.create({
        data: {
          unitId: unit.id,
          fromStatus: unit.status,
          toStatus: unitStatus,
          note: `Refurb job ${nextStatus}`,
        },
      });
    }
  }

  async updateStatus(jobPublicId, nextStatus, actor, opts = {}) {
    const job = await prisma.refurbishmentJob.findUnique({
      where: { publicId: jobPublicId },
      include: {
        returnRequest: {
          include: {
            orderItem: { include: { product: true, productVariant: true } },
            user: true,
            inspectionRecords: { orderBy: { createdAt: 'desc' }, take: 1 },
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
    if (['CLEANING', 'IRONING', 'REPAIR', 'IN_PROGRESS'].includes(nextStatus)) data.refurbishedAt = now;

    let listedProduct = null;
    const actorInternalId = await resolveActorUserId(actor);
    if (nextStatus === 'LISTED') {
      listedProduct = await this.createListedRefurbProduct(job, actorInternalId);
      data.listedAt = now;
      data.listedProductId = listedProduct.id;
    }

    if (opts.notes !== undefined) data.notes = opts.notes ? String(opts.notes).trim() : null;

    const updated = await prisma.refurbishmentJob.update({
      where: { id: job.id },
      data,
      include: { listedProduct: true },
    });

    await this.transitionUnitsForJob(job, nextStatus);

    await writeAdminAudit({
      actorId: actor?.id,
      actorEmail: actor?.email,
      action: 'REFURB_JOB_STATUS',
      entityType: 'RefurbishmentJob',
      entityId: jobPublicId,
      meta: { from: job.status, to: nextStatus },
    });

    return { job: updated, listedProduct: updated.listedProduct || listedProduct };
  }

  async createListedRefurbProduct(job, actorUserId = null) {
    const line = job.returnRequest.orderItem;
    const source = line?.product;
    if (!source) throw new AppError(400, 'Return has no product line to list');

    const refurbSku = `${source.sku}-RF`;

    return prisma.$transaction(async (tx) => {
      const sourceFull = await tx.product.findUnique({
        where: { id: source.id },
        include: { variants: { orderBy: { sortOrder: 'asc' } } },
      });
      if (!sourceFull) throw new AppError(400, 'Source product missing');

      const existing = await tx.product.findFirst({
        where: {
          productType: 'REFURBISHED',
          sourceProductId: source.id,
          isActiveListing: true,
        },
        include: { variants: { orderBy: { sortOrder: 'asc' } } },
      });

      if (existing) {
        const lineVariant = sourceFull.variants.find((v) => v.id === line.productVariantId);
        const { writeInventoryLedger } = await import('./inventory-ledger.service.js');
        const { syncParentStockFromVariants } = await import('./inventory.service.js');
        let ledgerVariantId = null;

        if (existing.variants.length > 0 && lineVariant) {
          const refurbVariant = findRefurbVariantForSource(existing.variants, lineVariant);
          if (!refurbVariant) {
            throw new AppError(400, 'Refurb variant row missing for returned SKU — contact support');
          }
          await tx.productVariant.update({
            where: { id: refurbVariant.id },
            data: { stock: refurbVariant.stock + 1 },
          });
          await syncParentStockFromVariants(tx, existing.id);
          ledgerVariantId = refurbVariant.id;
        } else if (existing.variants.length > 0 && !lineVariant) {
          throw new AppError(400, 'Return line missing variant — cannot restock variant-matrix refurb');
        } else {
          await tx.product.update({
            where: { id: existing.id },
            data: { stock: existing.stock + 1 },
          });
        }

        await tx.product.update({
          where: { id: existing.id },
          data: { conditionGrade: null },
        });

        await writeInventoryLedger(tx, {
          productId: existing.id,
          productVariantId: ledgerVariantId,
          quantityDelta: 1,
          eventType: 'RESTOCK',
          referenceType: 'refurbishment_job',
          referenceId: job.publicId,
          actorUserId,
          note: 'Refurbished unit restocked',
        });

        const units = await tx.productUnit.findMany({ where: { sourceReturnId: job.returnRequestId } });
        for (const unit of units) {
          await tx.productUnit.update({
            where: { id: unit.id },
            data: { status: 'AVAILABLE_REFURB', productId: existing.id, relistedAt: new Date() },
          });
          await tx.productUnitEvent.create({
            data: {
              unitId: unit.id,
              fromStatus: unit.status,
              toStatus: 'AVAILABLE_REFURB',
              note: `Restocked on existing refurb SKU ${refurbSku}`,
            },
          });
        }

        return tx.product.findUnique({
          where: { id: existing.id },
          include: { variants: { orderBy: { sortOrder: 'asc' } } },
        });
      }

      const baseName = `${source.name} (Refurbished)`;
      const slugBase = slugifyName(baseName);
      const { ensureUniqueSlug } = await import('./product.service.js');
      const slug = await ensureUniqueSlug(tx, `${slugBase}-${source.slug.slice(-6)}`);

      const isVariantSource =
        sourceFull.inventoryModel === 'variant_matrix' && sourceFull.variants.length > 0;
      const lineVariant = sourceFull.variants.find((v) => v.id === line.productVariantId);

      const refurbPrice =
        refurbPriceFrom(sourceFull.memberPrice) ??
        refurbPriceFrom(line.price) ??
        refurbPriceFrom(sourceFull.price) ??
        0;

      const product = await tx.product.create({
        data: {
          name: baseName,
          slug,
          sku: refurbSku,
          description: sourceFull.description,
          price: refurbPrice,
          memberPrice: refurbPriceFrom(sourceFull.memberPrice),
          compareAtPrice: sourceFull.compareAtPrice ?? sourceFull.price,
          stock: isVariantSource ? 0 : 1,
          reservedStock: 0,
          inventoryModel: isVariantSource ? 'variant_matrix' : 'simple',
          categoryId: sourceFull.categoryId,
          imageUrl: sourceFull.imageUrl,
          gallery: sourceFull.gallery ?? undefined,
          fabric: sourceFull.fabric,
          care: sourceFull.care,
          sizeAgeGroup: sourceFull.sizeAgeGroup,
          vendor: sourceFull.vendor,
          tags: sourceFull.tags,
          productType: 'REFURBISHED',
          isDraft: false,
          isActiveListing: true,
          sourceReturnId: job.returnRequestId,
          sourceProductId: sourceFull.id,
          conditionGrade: null,
          refurbishedAt: new Date(),
        },
      });

      const { writeInventoryLedger } = await import('./inventory-ledger.service.js');
      const { syncParentStockFromVariants } = await import('./inventory.service.js');
      let ledgerVariantId = null;

      if (isVariantSource) {
        if (!lineVariant) {
          throw new AppError(400, 'Return line missing variant — cannot list variant-matrix refurb');
        }
        for (const sv of sourceFull.variants) {
          const isReturned = sv.id === lineVariant.id;
          const variantPrice =
            sv.priceOverride != null ? refurbPriceFrom(sv.priceOverride) : refurbPrice;
          const created = await tx.productVariant.create({
            data: {
              productId: product.id,
              combination: sv.combination,
              sku: refurbVariantSku(sv.sku),
              stock: isReturned ? 1 : 0,
              reservedStock: 0,
              priceOverride: variantPrice,
              imageUrl: sv.imageUrl,
              sortOrder: sv.sortOrder,
            },
          });
          if (isReturned) ledgerVariantId = created.id;
        }
        await syncParentStockFromVariants(tx, product.id);
      }

      await writeInventoryLedger(tx, {
        productId: product.id,
        productVariantId: ledgerVariantId,
        quantityDelta: 1,
        eventType: 'RESTOCK',
        referenceType: 'refurbishment_job',
        referenceId: job.publicId,
        actorUserId,
        note: 'Refurbished unit listed',
      });

      const units = await tx.productUnit.findMany({ where: { sourceReturnId: job.returnRequestId } });
      for (const unit of units) {
        await tx.productUnit.update({
          where: { id: unit.id },
          data: { status: 'AVAILABLE_REFURB', productId: product.id, relistedAt: new Date() },
        });
        await tx.productUnitEvent.create({
          data: {
            unitId: unit.id,
            fromStatus: unit.status,
            toStatus: 'AVAILABLE_REFURB',
            note: `Listed as refurb SKU ${refurbSku}`,
          },
        });
      }

      return product;
    });
  }
}

export const refurbishmentService = new RefurbishmentService();
