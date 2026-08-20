import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../utils/error-handler.js';
import { writeAdminAudit } from './audit.service.js';
import { seedHomepageCarousel } from '../scripts/seed-homepage-carousel.js';

const SLIDE_TYPES = ['HERO', 'PRODUCT_GRID', 'LETTER'];

const cardInputSchema = z.object({
  publicId: z.string().optional().nullable(),
  sortOrder: z.number().int().optional(),
  productPublicId: z.string().optional().nullable(),
  customName: z.string().max(200).optional().nullable(),
  customCategory: z.string().max(120).optional().nullable(),
  customImageUrl: z.string().max(2000).optional().nullable(),
  customMemberPrice: z.number().nonnegative().optional().nullable(),
  customFullPrice: z.number().nonnegative().optional().nullable(),
  customHref: z.string().max(500).optional().nullable(),
  isRefurbished: z.boolean().optional(),
  placeholderBg: z.string().max(40).optional().nullable(),
});

const slideInputSchema = z.object({
  slideType: z.enum(SLIDE_TYPES),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  eyebrow: z.string().max(120).optional().nullable(),
  title: z.string().max(500).optional().nullable(),
  subtitle: z.string().max(1000).optional().nullable(),
  bodyText: z.string().max(20000).optional().nullable(),
  backgroundTone: z.string().max(40).optional().nullable(),
  primaryCtaLabel: z.string().max(80).optional().nullable(),
  primaryCtaHref: z.string().max(500).optional().nullable(),
  secondaryCtaLabel: z.string().max(80).optional().nullable(),
  secondaryCtaHref: z.string().max(500).optional().nullable(),
  chipLabel: z.string().max(160).optional().nullable(),
  rewardPercent: z.string().max(20).optional().nullable(),
  rewardLabel: z.string().max(500).optional().nullable(),
  imageUrl1: z.string().max(2000).optional().nullable(),
  imageLabel1: z.string().max(160).optional().nullable(),
  imageUrl2: z.string().max(2000).optional().nullable(),
  imageLabel2: z.string().max(160).optional().nullable(),
  backgroundImageUrl: z.string().max(2000).optional().nullable(),
  signatureName: z.string().max(120).optional().nullable(),
  signatureFrom: z.string().max(240).optional().nullable(),
  productCards: z.array(cardInputSchema).optional(),
});

const slideInclude = {
  productCards: {
    orderBy: { sortOrder: 'asc' },
    include: {
      product: {
        select: {
          publicId: true,
          name: true,
          slug: true,
          imageUrl: true,
          price: true,
          memberPrice: true,
          productType: true,
          isActiveListing: true,
          isDraft: true,
          category: { select: { name: true } },
        },
      },
    },
  },
};

function mapCard(card) {
  const product = card.product;
  const fromProduct = product && !product.isDraft && product.isActiveListing;
  const productPath = fromProduct && product.slug ? `/products/${product.slug}` : null;
  const href = card.customHref || productPath || null;
  const categoryFromProduct =
    product?.productType === 'REFURBISHED'
      ? 'Refurbished'
      : product?.category?.name || null;
  return {
    id: card.publicId,
    sortOrder: card.sortOrder,
    productId: product?.publicId ?? null,
    productSlug: fromProduct ? product.slug : null,
    href,
    customHref: card.customHref || null,
    name: card.customName || product?.name || 'Product',
    category: card.customCategory || categoryFromProduct,
    imageUrl: card.customImageUrl || product?.imageUrl || null,
    memberPrice:
      card.customMemberPrice ??
      (fromProduct
        ? product.memberPrice != null
          ? Number(product.memberPrice)
          : product.price != null
            ? Number(product.price)
            : null
        : null),
    fullPrice:
      card.customFullPrice ?? (fromProduct && product.price != null ? Number(product.price) : null),
    isRefurbished: card.isRefurbished || product?.productType === 'REFURBISHED' || false,
    placeholderBg: card.placeholderBg || null,
  };
}

function mapSlide(slide) {
  return {
    id: slide.publicId,
    sortOrder: slide.sortOrder,
    isActive: slide.isActive,
    slideType: slide.slideType,
    eyebrow: slide.eyebrow,
    title: slide.title,
    subtitle: slide.subtitle,
    bodyText: slide.bodyText,
    backgroundTone: slide.backgroundTone,
    primaryCtaLabel: slide.primaryCtaLabel,
    primaryCtaHref: slide.primaryCtaHref,
    secondaryCtaLabel: slide.secondaryCtaLabel,
    secondaryCtaHref: slide.secondaryCtaHref,
    chipLabel: slide.chipLabel,
    rewardPercent: slide.rewardPercent,
    rewardLabel: slide.rewardLabel,
    imageUrl1: slide.imageUrl1,
    imageLabel1: slide.imageLabel1,
    imageUrl2: slide.imageUrl2,
    imageLabel2: slide.imageLabel2,
    backgroundImageUrl: slide.backgroundImageUrl,
    signatureName: slide.signatureName,
    signatureFrom: slide.signatureFrom,
    productCards: (slide.productCards || []).map(mapCard),
    updatedAt: slide.updatedAt,
  };
}

async function resolveProductIds(cards = []) {
  const publicIds = cards.map((c) => c.productPublicId).filter(Boolean);
  if (!publicIds.length) return new Map();
  const products = await prisma.product.findMany({
    where: { publicId: { in: publicIds } },
    select: { id: true, publicId: true },
  });
  return new Map(products.map((p) => [p.publicId, p.id]));
}

async function buildCardCreates(cards = []) {
  const idMap = await resolveProductIds(cards);
  return cards.map((c, index) => ({
    sortOrder: c.sortOrder ?? index,
    productId: c.productPublicId ? idMap.get(c.productPublicId) ?? null : null,
    customName: c.customName ?? null,
    customCategory: c.customCategory ?? null,
    customImageUrl: c.customImageUrl ?? null,
    customMemberPrice: c.customMemberPrice ?? null,
    customFullPrice: c.customFullPrice ?? null,
    customHref: c.customHref ?? null,
    isRefurbished: Boolean(c.isRefurbished),
    placeholderBg: c.placeholderBg ?? null,
  }));
}

/** Lightweight catalog search for linking PRODUCT_GRID cards (homepage module). */
export async function searchProductsForCarousel(q = '', limit = 12) {
  const term = String(q || '').trim();
  const take = Math.min(Math.max(Number(limit) || 12, 1), 30);
  const where = {
    isDraft: false,
    isActiveListing: true,
    ...(term
      ? {
          OR: [
            { name: { contains: term, mode: 'insensitive' } },
            { slug: { contains: term, mode: 'insensitive' } },
            { publicId: { contains: term, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const products = await prisma.product.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take,
    select: {
      publicId: true,
      name: true,
      slug: true,
      imageUrl: true,
      price: true,
      memberPrice: true,
      productType: true,
      category: { select: { name: true } },
    },
  });
  return products.map((p) => ({
    id: p.publicId,
    name: p.name,
    slug: p.slug,
    imageUrl: p.imageUrl,
    category:
      p.productType === 'REFURBISHED' ? 'Refurbished' : p.category?.name || null,
    memberPrice: p.memberPrice != null ? Number(p.memberPrice) : p.price != null ? Number(p.price) : null,
    fullPrice: p.price != null ? Number(p.price) : null,
    isRefurbished: p.productType === 'REFURBISHED',
  }));
}

export async function listPublicHomepageCarousel() {
  let slides = await prisma.homepageCarouselSlide.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
    include: slideInclude,
  });

  if (!slides.length) {
    await seedHomepageCarousel(prisma);
    slides = await prisma.homepageCarouselSlide.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: slideInclude,
    });
  }

  return slides.map(mapSlide);
}

export async function listAdminHomepageCarousel() {
  const slides = await prisma.homepageCarouselSlide.findMany({
    orderBy: { sortOrder: 'asc' },
    include: slideInclude,
  });
  return slides.map(mapSlide);
}

export async function getAdminHomepageCarouselSlide(publicId) {
  const slide = await prisma.homepageCarouselSlide.findUnique({
    where: { publicId },
    include: slideInclude,
  });
  if (!slide) throw new AppError(404, 'Slide not found');
  return mapSlide(slide);
}

export async function createHomepageCarouselSlide(actor, payload) {
  const body = slideInputSchema.parse(payload);
  const max = await prisma.homepageCarouselSlide.aggregate({ _max: { sortOrder: true } });
  const sortOrder = body.sortOrder ?? (max._max.sortOrder ?? -1) + 1;
  const cards = body.slideType === 'PRODUCT_GRID' ? await buildCardCreates(body.productCards || []) : [];

  const { productCards: _pc, sortOrder: _so, ...rest } = body;
  const slide = await prisma.homepageCarouselSlide.create({
    data: {
      ...rest,
      sortOrder,
      isActive: body.isActive ?? true,
      productCards: cards.length ? { create: cards } : undefined,
    },
    include: slideInclude,
  });

  await writeAdminAudit({
    actorId: actor?.id ?? null,
    actorEmail: actor?.email ?? null,
    action: 'HOMEPAGE_CAROUSEL_CREATE',
    entityType: 'HomepageCarouselSlide',
    entityId: slide.publicId,
    meta: { slideType: slide.slideType },
  });

  return mapSlide(slide);
}

export async function updateHomepageCarouselSlide(actor, publicId, payload) {
  const existing = await prisma.homepageCarouselSlide.findUnique({ where: { publicId } });
  if (!existing) throw new AppError(404, 'Slide not found');

  const body = slideInputSchema.partial().extend({ slideType: z.enum(SLIDE_TYPES).optional() }).parse(payload);
  const { productCards, ...rest } = body;

  const slide = await prisma.$transaction(async (tx) => {
    if (productCards) {
      await tx.homepageCarouselProductCard.deleteMany({ where: { slideId: existing.id } });
      const creates = await buildCardCreates(productCards);
      if (creates.length) {
        await tx.homepageCarouselProductCard.createMany({
          data: creates.map((c) => ({ ...c, slideId: existing.id })),
        });
      }
    }

    return tx.homepageCarouselSlide.update({
      where: { id: existing.id },
      data: rest,
      include: slideInclude,
    });
  });

  await writeAdminAudit({
    actorId: actor?.id ?? null,
    actorEmail: actor?.email ?? null,
    action: 'HOMEPAGE_CAROUSEL_UPDATE',
    entityType: 'HomepageCarouselSlide',
    entityId: slide.publicId,
    meta: { fields: Object.keys(rest) },
  });

  return mapSlide(slide);
}

export async function deleteHomepageCarouselSlide(actor, publicId) {
  const existing = await prisma.homepageCarouselSlide.findUnique({ where: { publicId } });
  if (!existing) throw new AppError(404, 'Slide not found');

  // Soft-deactivate by default (plan preference)
  const slide = await prisma.homepageCarouselSlide.update({
    where: { id: existing.id },
    data: { isActive: false },
    include: slideInclude,
  });

  await writeAdminAudit({
    actorId: actor?.id ?? null,
    actorEmail: actor?.email ?? null,
    action: 'HOMEPAGE_CAROUSEL_DEACTIVATE',
    entityType: 'HomepageCarouselSlide',
    entityId: slide.publicId,
  });

  return mapSlide(slide);
}

export async function hardDeleteHomepageCarouselSlide(actor, publicId) {
  const existing = await prisma.homepageCarouselSlide.findUnique({ where: { publicId } });
  if (!existing) throw new AppError(404, 'Slide not found');

  await prisma.homepageCarouselSlide.delete({ where: { id: existing.id } });

  await writeAdminAudit({
    actorId: actor?.id ?? null,
    actorEmail: actor?.email ?? null,
    action: 'HOMEPAGE_CAROUSEL_DELETE',
    entityType: 'HomepageCarouselSlide',
    entityId: publicId,
  });

  return { id: publicId, deleted: true };
}

export async function reorderHomepageCarousel(actor, orderedIds) {
  const ids = z.array(z.string().min(1)).min(1).parse(orderedIds);
  const slides = await prisma.homepageCarouselSlide.findMany({
    where: { publicId: { in: ids } },
    select: { id: true, publicId: true },
  });
  if (slides.length !== ids.length) throw new AppError(400, 'One or more slide ids are invalid');

  const byPublic = new Map(slides.map((s) => [s.publicId, s.id]));
  await prisma.$transaction(
    ids.map((publicId, index) =>
      prisma.homepageCarouselSlide.update({
        where: { id: byPublic.get(publicId) },
        data: { sortOrder: index },
      })
    )
  );

  await writeAdminAudit({
    actorId: actor?.id ?? null,
    actorEmail: actor?.email ?? null,
    action: 'HOMEPAGE_CAROUSEL_REORDER',
    entityType: 'HomepageCarouselSlide',
    entityId: 'all',
    meta: { orderedIds: ids },
  });

  return listAdminHomepageCarousel();
}
