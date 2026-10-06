import { prisma } from '../lib/prisma.js';
import { AppError } from '../utils/error-handler.js';
import { writeAdminAudit } from './audit.service.js';

const LIVE = { status: 'APPROVED', deletedAt: null };
const MAX_IMAGES = 5;
const MAX_BODY = 4000;

function emptyBreakdown() {
  return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
}

function actorOf(user) {
  return {
    actorId: user?.id ?? user?.publicId ?? null,
    actorEmail: user?.email ?? null,
  };
}

async function staffUserId(user) {
  const publicId = user?.id || user?.publicId;
  if (!publicId) return null;
  const row = await prisma.user.findUnique({ where: { publicId: String(publicId) }, select: { id: true } });
  return row?.id ?? null;
}

async function customerUserId(user) {
  const publicId = user?.id || user?.publicId;
  if (!publicId) throw new AppError(401, 'Sign in required');
  const row = await prisma.user.findUnique({
    where: { publicId: String(publicId) },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  if (!row) throw new AppError(401, 'Sign in required');
  return row;
}

function displayName(user) {
  const parts = [user.firstName, user.lastName].filter(Boolean);
  if (parts.length) return parts.join(' ');
  if (user.email) {
    const local = String(user.email).split('@')[0];
    return local || 'Customer';
  }
  return 'Customer';
}

function clampRating(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 5) {
    throw new AppError(400, 'Rating must be an integer from 1 to 5');
  }
  return n;
}

function normalizeImages(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new AppError(400, 'imageUrls must be an array');
  const urls = raw.map((u) => String(u || '').trim()).filter(Boolean);
  if (urls.length > MAX_IMAGES) throw new AppError(400, `At most ${MAX_IMAGES} images allowed`);
  return urls;
}

function normalizeBody(raw) {
  if (raw == null || raw === '') return null;
  const text = String(raw).trim();
  if (text.length > MAX_BODY) throw new AppError(400, `Review text must be at most ${MAX_BODY} characters`);
  return text || null;
}

function toPublicReview(row) {
  return {
    id: row.publicId,
    rating: row.rating,
    body: row.body,
    imageUrls: Array.isArray(row.imageUrls) ? row.imageUrls : [],
    reviewerName: row.reviewerDisplayName || 'Customer',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toOwnerReview(row) {
  return {
    ...toPublicReview(row),
    status: row.status,
    productId: row.product?.publicId ?? undefined,
    orderId: row.order?.publicId ?? undefined,
  };
}

function toAdminReview(row) {
  return {
    id: row.publicId,
    rating: row.rating,
    body: row.body,
    imageUrls: Array.isArray(row.imageUrls) ? row.imageUrls : [],
    status: row.status,
    reviewerName: row.reviewerDisplayName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    product: row.product
      ? { id: row.product.publicId, name: row.product.name, slug: row.product.slug }
      : null,
    customer: row.user
      ? {
          id: row.user.publicId,
          email: row.user.email,
          name: displayName(row.user),
        }
      : null,
  };
}

export async function recomputeProductRating(productId) {
  const rows = await prisma.productReview.groupBy({
    by: ['rating'],
    where: { productId, ...LIVE },
    _count: { _all: true },
  });
  const breakdown = emptyBreakdown();
  let total = 0;
  let sum = 0;
  for (const row of rows) {
    const star = row.rating;
    const count = row._count._all;
    if (star >= 1 && star <= 5) {
      breakdown[star] = count;
      total += count;
      sum += star * count;
    }
  }
  const averageRating = total ? Math.round((sum / total) * 10) / 10 : null;
  await prisma.product.update({
    where: { id: productId },
    data: {
      averageRating,
      reviewCount: total,
      ratingBreakdown: breakdown,
    },
  });
  return { averageRating, reviewCount: total, ratingBreakdown: breakdown };
}

async function resolveProduct(identifier) {
  const raw = String(identifier ?? '').trim();
  if (!raw) throw new AppError(404, 'Product not found');
  let product = await prisma.product.findUnique({ where: { slug: raw } });
  if (!product) product = await prisma.product.findUnique({ where: { publicId: raw } });
  if (!product || product.isDraft || !product.isActiveListing) {
    throw new AppError(404, 'Product not found');
  }
  return product;
}

function purchaseWhere(userId, productId) {
  return {
    productId,
    cancelledAt: null,
    order: {
      userId,
      paymentStatus: 'PAID',
      status: { not: 'CANCELLED' },
      OR: [{ status: 'DELIVERED' }, { fulfillmentStatus: 'DELIVERED' }, { deliveredAt: { not: null } }],
    },
  };
}

async function findEligiblePurchase(userId, productId) {
  return prisma.orderItem.findFirst({
    where: purchaseWhere(userId, productId),
    orderBy: { createdAt: 'desc' },
    include: { order: { select: { id: true, publicId: true, orderNumber: true } } },
  });
}

export async function listProductReviewsPublic(identifier, { page = 1, limit = 10 } = {}) {
  const product = await resolveProduct(identifier);
  const take = Math.min(50, Math.max(1, Number(limit) || 10));
  const currentPage = Math.max(1, Number(page) || 1);
  const where = { productId: product.id, ...LIVE };
  const [items, total] = await Promise.all([
    prisma.productReview.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (currentPage - 1) * take,
      take,
    }),
    prisma.productReview.count({ where }),
  ]);
  const breakdown = product.ratingBreakdown && typeof product.ratingBreakdown === 'object'
    ? product.ratingBreakdown
    : emptyBreakdown();
  return {
    summary: {
      averageRating: product.averageRating,
      reviewCount: product.reviewCount || 0,
      ratingBreakdown: breakdown,
    },
    items: items.map(toPublicReview),
    pagination: {
      page: currentPage,
      limit: take,
      total,
      pages: Math.ceil(total / take) || 1,
    },
  };
}

export async function getProductReviewEligibility(user, identifier) {
  const product = await resolveProduct(identifier);
  const me = await customerUserId(user);
  const purchase = await findEligiblePurchase(me.id, product.id);
  const existing = await prisma.productReview.findFirst({
    where: { userId: me.id, productId: product.id, deletedAt: null },
  });
  return {
    canReview: Boolean(purchase) && (!existing || existing.status === 'REJECTED'),
    canEdit: Boolean(existing && existing.status === 'APPROVED' && !existing.deletedAt),
    hasPurchased: Boolean(purchase),
    existingReview: existing ? toOwnerReview(existing) : null,
  };
}

export async function createProductReview(user, body) {
  const me = await customerUserId(user);
  const productIdRaw = body?.productId;
  if (!productIdRaw) throw new AppError(400, 'productId is required');
  const product = await resolveProduct(productIdRaw);
  const purchase = await findEligiblePurchase(me.id, product.id);
  if (!purchase) {
    throw new AppError(403, 'Only customers who purchased this product can leave a review');
  }
  const rating = clampRating(body.rating);
  const reviewBody = normalizeBody(body.body);
  const imageUrls = normalizeImages(body.imageUrls);
  const name = body.reviewerDisplayName?.trim() || displayName(me);

  const existing = await prisma.productReview.findUnique({
    where: { userId_productId: { userId: me.id, productId: product.id } },
  });
  if (existing && !existing.deletedAt && existing.status === 'APPROVED') {
    throw new AppError(409, 'You already reviewed this product. Edit your existing review instead.');
  }

  let row;
  if (existing) {
    row = await prisma.productReview.update({
      where: { id: existing.id },
      data: {
        rating,
        body: reviewBody,
        imageUrls,
        status: 'APPROVED',
        deletedAt: null,
        reviewerDisplayName: name,
        orderId: purchase.orderId,
        orderItemId: purchase.id,
      },
    });
  } else {
    row = await prisma.productReview.create({
      data: {
        productId: product.id,
        userId: me.id,
        orderId: purchase.orderId,
        orderItemId: purchase.id,
        rating,
        body: reviewBody,
        imageUrls,
        status: 'APPROVED',
        reviewerDisplayName: name,
      },
    });
  }
  await recomputeProductRating(product.id);
  return toOwnerReview(row);
}

export async function updateProductReview(user, publicId, body) {
  const me = await customerUserId(user);
  const existing = await prisma.productReview.findFirst({
    where: { publicId: String(publicId), userId: me.id, deletedAt: null },
  });
  if (!existing) throw new AppError(404, 'Review not found');
  if (existing.status === 'REJECTED') {
    throw new AppError(403, 'This review was rejected. Contact support if you need help.');
  }
  const data = {};
  if (body.rating != null) data.rating = clampRating(body.rating);
  if (body.body !== undefined) data.body = normalizeBody(body.body);
  if (body.imageUrls !== undefined) data.imageUrls = normalizeImages(body.imageUrls);
  if (body.reviewerDisplayName !== undefined) {
    data.reviewerDisplayName = String(body.reviewerDisplayName || '').trim() || displayName(me);
  }
  data.status = 'APPROVED';
  const row = await prisma.productReview.update({ where: { id: existing.id }, data });
  await recomputeProductRating(existing.productId);
  return toOwnerReview(row);
}

export async function deleteOwnProductReview(user, publicId) {
  const me = await customerUserId(user);
  const existing = await prisma.productReview.findFirst({
    where: { publicId: String(publicId), userId: me.id, deletedAt: null },
  });
  if (!existing) throw new AppError(404, 'Review not found');
  await prisma.productReview.update({
    where: { id: existing.id },
    data: { deletedAt: new Date() },
  });
  await recomputeProductRating(existing.productId);
  return { id: existing.publicId, deleted: true };
}

export async function getAdminProductReview(publicId) {
  const row = await prisma.productReview.findFirst({
    where: { publicId: String(publicId), deletedAt: null },
    include: {
      product: { select: { publicId: true, name: true, slug: true, imageUrl: true } },
      user: { select: { publicId: true, email: true, firstName: true, lastName: true } },
      order: { select: { publicId: true, orderNumber: true } },
    },
  });
  if (!row) throw new AppError(404, 'Review not found');
  return {
    ...toAdminReview(row),
    product: row.product
      ? {
          id: row.product.publicId,
          name: row.product.name,
          slug: row.product.slug,
          imageUrl: row.product.imageUrl ?? null,
        }
      : null,
    order: row.order
      ? { id: row.order.publicId, orderNumber: row.order.orderNumber }
      : null,
  };
}

export async function listAdminProductReviews({ search, status, rating, page = 1, limit = 20 } = {}) {
  const take = Math.min(100, Math.max(1, Number(limit) || 20));
  const currentPage = Math.max(1, Number(page) || 1);
  const where = { deletedAt: null };
  if (status === 'APPROVED' || status === 'REJECTED') where.status = status;
  if (rating != null && rating !== '') where.rating = clampRating(rating);
  if (search && String(search).trim()) {
    const q = String(search).trim();
    where.OR = [
      { body: { contains: q, mode: 'insensitive' } },
      { reviewerDisplayName: { contains: q, mode: 'insensitive' } },
      { product: { name: { contains: q, mode: 'insensitive' } } },
      { user: { email: { contains: q, mode: 'insensitive' } } },
    ];
  }
  const [rows, total] = await Promise.all([
    prisma.productReview.findMany({
      where,
      include: {
        product: { select: { publicId: true, name: true, slug: true } },
        user: { select: { publicId: true, email: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (currentPage - 1) * take,
      take,
    }),
    prisma.productReview.count({ where }),
  ]);
  return {
    items: rows.map(toAdminReview),
    pagination: { page: currentPage, limit: take, total, pages: Math.ceil(total / take) || 1 },
  };
}

export async function rejectProductReview(user, publicId) {
  const existing = await prisma.productReview.findFirst({
    where: { publicId: String(publicId), deletedAt: null },
  });
  if (!existing) throw new AppError(404, 'Review not found');
  const row = await prisma.productReview.update({
    where: { id: existing.id },
    data: { status: 'REJECTED' },
    include: {
      product: { select: { publicId: true, name: true, slug: true } },
      user: { select: { publicId: true, email: true, firstName: true, lastName: true } },
    },
  });
  await recomputeProductRating(existing.productId);
  await writeAdminAudit({
    ...actorOf(user),
    action: 'PRODUCT_REVIEW_REJECTED',
    entityType: 'ProductReview',
    entityId: row.publicId,
    meta: { productId: row.product?.publicId, rating: row.rating },
  });
  return toAdminReview(row);
}

export async function removeProductReviewAdmin(user, publicId) {
  const existing = await prisma.productReview.findFirst({
    where: { publicId: String(publicId), deletedAt: null },
  });
  if (!existing) throw new AppError(404, 'Review not found');
  const row = await prisma.productReview.update({
    where: { id: existing.id },
    data: { deletedAt: new Date() },
    include: {
      product: { select: { publicId: true, name: true, slug: true } },
      user: { select: { publicId: true, email: true, firstName: true, lastName: true } },
    },
  });
  await recomputeProductRating(existing.productId);
  await writeAdminAudit({
    ...actorOf(user),
    action: 'PRODUCT_REVIEW_REMOVED',
    entityType: 'ProductReview',
    entityId: row.publicId,
    meta: { productId: row.product?.publicId, rating: row.rating, by: await staffUserId(user) },
  });
  return toAdminReview(row);
}
