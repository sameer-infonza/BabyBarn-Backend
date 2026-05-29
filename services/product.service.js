import { randomBytes } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../utils/error-handler.js';
import { slugifyName } from '../utils/slug.js';
import { config } from '../config/env.js';

const prisma = new PrismaClient();

function normalizeMediaUrl(url) {
  if (!url) return null;
  const u = String(url).trim();
  if (!u) return null;
  if (u.startsWith('/')) return u;

  const knownBases = [
    config.publicBaseUrl,
    `http://localhost:${config.port}`,
    `https://localhost:${config.port}`,
  ].filter(Boolean);

  for (const base of knownBases) {
    if (u.startsWith(base)) {
      const rest = u.slice(base.length);
      return rest.startsWith('/') ? rest : `/${rest}`;
    }
  }

  const match = u.match(/^https?:\/\/[^/]+(\/.*)$/);
  if (match) {
    return match[1] || '/';
  }

  return u;
}

function randomSku(prefix) {
  const hex = randomBytes(5).toString('hex').toUpperCase();
  return `${prefix}-${hex}`;
}

async function ensureUniqueSlug(tx, base) {
  let slug = base;
  let n = 0;
  while (true) {
    const exists = await tx.product.findUnique({ where: { slug }, select: { id: true } });
    if (!exists) return slug;
    n += 1;
    slug = `${base}-${n}`;
  }
}

async function ensureUniqueParentSku(tx) {
  for (let i = 0; i < 20; i += 1) {
    const sku = randomSku('PARENT');
    const exists = await tx.product.findUnique({ where: { sku }, select: { id: true } });
    if (!exists) return sku;
  }
  throw new AppError(500, 'Could not allocate a unique product SKU');
}

export class ProductService {
  async getAdminProductStats() {
    const [total, activeListings, outOfStock] = await Promise.all([
      prisma.product.count(),
      prisma.product.count({
        where: { isDraft: false, isActiveListing: true },
      }),
      prisma.product.count({
        where: { isDraft: false, stock: 0 },
      }),
    ]);
    return { total, activeListings, outOfStock };
  }

  /**
   * @param {object} [listFilters]
   * **Public:** `search`, `sort` (newest | price_asc | price_desc | name_asc | name_desc), `productType` / `productTypes` (comma-separated NEW,REFURBISHED), `minPrice`, `maxPrice`, `sizeAgeGroup` (exact, legacy), `ageGroup` / `ageGroups` and `fitSize` / `fitSizes` (comma-separated substring match on `sizeAgeGroup`, OR within group, AND between groups), `categoryId` (comma-separated public ids)
   * **Admin:** `search`, `sizeAgeGroup`, `status` (active | inactive | draft | low_stock | all)
   */
  async getAllProducts(page = 1, limit = 20, categoryPublicId, { admin = false, listFilters } = {}) {
    const skip = (page - 1) * limit;
    const { isRefurbishedEnabled } = await import('../config/feature-flags.js');
    const refurbishedEnabled = isRefurbishedEnabled();

    const parseCsv = (value) => {
      if (value == null || value === '') return [];
      if (Array.isArray(value)) return value.map(String).filter(Boolean);
      return String(value)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    };

    const categoryPublicIds = [
      ...parseCsv(listFilters?.categoryIds),
      ...(categoryPublicId ? [String(categoryPublicId)] : []),
    ].filter((id, idx, arr) => arr.indexOf(id) === idx);

    const productTypesRaw = [
      ...parseCsv(listFilters?.productTypes),
      ...(listFilters?.productType ? [listFilters.productType] : []),
    ].filter((t) => t === 'NEW' || t === 'REFURBISHED');
    const productTypes = [...new Set(productTypesRaw)];

    if (!admin && productTypes.includes('REFURBISHED') && !refurbishedEnabled) {
      return {
        products: [],
        pagination: { total: 0, page, limit, pages: 1 },
      };
    }

    let categoryIds = [];
    if (categoryPublicIds.length > 0) {
      const categories = await prisma.category.findMany({
        where: { publicId: { in: categoryPublicIds } },
        select: { id: true, publicId: true },
      });
      if (categories.length === 0) {
        throw new AppError(404, 'Category not found');
      }
      const found = new Set(categories.map((c) => c.publicId));
      const missing = categoryPublicIds.filter((id) => !found.has(id));
      if (missing.length > 0) {
        throw new AppError(404, 'Category not found');
      }
      categoryIds = categories.map((c) => c.id);
    }

    const where = {};
    if (categoryIds.length === 1) where.categoryId = categoryIds[0];
    else if (categoryIds.length > 1) where.categoryId = { in: categoryIds };
    if (!admin) {
      where.isDraft = false;
      where.isActiveListing = true;
      if (listFilters) {
        const { search, minPrice, maxPrice, sizeAgeGroup } = listFilters;
        if (productTypes.length === 1) {
          where.productType = productTypes[0];
        } else if (productTypes.length > 1) {
          where.productType = { in: productTypes };
        } else if (!refurbishedEnabled) {
          where.productType = { not: 'REFURBISHED' };
        }

        const ageGroups = [
          ...parseCsv(listFilters.ageGroups),
          ...(listFilters.ageGroup ? [listFilters.ageGroup] : []),
        ].filter(Boolean);
        const fitSizes = [
          ...parseCsv(listFilters.fitSizes),
          ...(listFilters.fitSize ? [listFilters.fitSize] : []),
        ].filter(Boolean);

        if (ageGroups.length > 0) {
          where.AND = where.AND ?? [];
          where.AND.push({
            OR: ageGroups.map((age) => ({
              sizeAgeGroup: { contains: age, mode: 'insensitive' },
            })),
          });
        } else if (fitSizes.length === 0 && sizeAgeGroup && String(sizeAgeGroup).trim()) {
          where.sizeAgeGroup = String(sizeAgeGroup).trim();
        }

        if (fitSizes.length > 0) {
          where.AND = where.AND ?? [];
          where.AND.push({
            OR: fitSizes.map((fit) => ({
              sizeAgeGroup: { contains: fit, mode: 'insensitive' },
            })),
          });
        }
        if (search && String(search).trim()) {
          const q = String(search).trim();
          where.AND = where.AND ?? [];
          where.AND.push({
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { description: { contains: q, mode: 'insensitive' } },
              { sku: { contains: q, mode: 'insensitive' } },
            ],
          });
        }
        const pf = {};
        if (minPrice != null && Number.isFinite(Number(minPrice))) {
          pf.gte = Number(minPrice);
        }
        if (maxPrice != null && Number.isFinite(Number(maxPrice))) {
          pf.lte = Number(maxPrice);
        }
        if (Object.keys(pf).length > 0) {
          where.price = pf;
        }
      }
    } else if (listFilters) {
      const { search, sizeAgeGroup, status, productType } = listFilters;
      if (productType === 'NEW' || productType === 'REFURBISHED') {
        where.productType = productType;
      }
      if (sizeAgeGroup && String(sizeAgeGroup).trim()) {
        where.sizeAgeGroup = String(sizeAgeGroup).trim();
      }
      const st = status && String(status).trim() ? String(status).trim() : 'all';
      if (st === 'active') {
        where.isDraft = false;
        where.isActiveListing = true;
      } else if (st === 'inactive') {
        where.isDraft = false;
        where.isActiveListing = false;
      } else if (st === 'draft') {
        where.isDraft = true;
      } else if (st === 'low_stock') {
        where.isDraft = false;
        where.stock = { gt: 0, lt: 10 };
      }
      if (search && String(search).trim()) {
        const q = String(search).trim();
        where.AND = where.AND ?? [];
        where.AND.push({
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { description: { contains: q, mode: 'insensitive' } },
            { sku: { contains: q, mode: 'insensitive' } },
          ],
        });
      }
    }

    let orderBy = { updatedAt: 'desc' };
    if (!admin && listFilters?.sort) {
      const s = String(listFilters.sort);
      if (s === 'price_asc') orderBy = { price: 'asc' };
      else if (s === 'price_desc') orderBy = { price: 'desc' };
      else if (s === 'name_asc') orderBy = { name: 'asc' };
      else if (s === 'name_desc') orderBy = { name: 'desc' };
      else if (s === 'newest') orderBy = { updatedAt: 'desc' };
    }

    const include = {
      category: true,
      ...(admin
        ? { variants: { orderBy: { sortOrder: 'asc' } } }
        : {
            variants: {
              orderBy: { sortOrder: 'asc' },
              select: {
                publicId: true,
                sku: true,
                stock: true,
                priceOverride: true,
                combination: true,
              },
            },
          }),
    };

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include,
      }),
      prisma.product.count({ where }),
    ]);

    return {
      products,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Public storefront: resolve by URL slug first, then by publicId (legacy links).
   * Admin callers should pass publicId only.
   */
  async getProductById(identifier, { admin = false } = {}) {
    const raw = String(identifier ?? '').trim();
    if (!raw) {
      throw new AppError(404, 'Product not found');
    }

    let product = await prisma.product.findUnique({
      where: { slug: raw },
      include: { category: true, variants: { orderBy: { sortOrder: 'asc' } } },
    });

    if (!product) {
      product = await prisma.product.findUnique({
        where: { publicId: raw },
        include: { category: true, variants: { orderBy: { sortOrder: 'asc' } } },
      });
    }

    if (!product) {
      throw new AppError(404, 'Product not found');
    }

    if (!admin && (product.isDraft || !product.isActiveListing)) {
      throw new AppError(404, 'Product not found');
    }

    const { isRefurbishedEnabled } = await import('../config/feature-flags.js');
    if (!admin && product.productType === 'REFURBISHED' && !isRefurbishedEnabled()) {
      throw new AppError(404, 'Product not found');
    }

    return product;
  }

  async createProduct(data) {
    const { isRefurbishedEnabled } = await import('../config/feature-flags.js');
    const {
      categoryId: categoryPublicId,
      variants = [],
      slug: requestedSlug,
      gallery,
      inventoryModel = 'simple',
      sku: incomingSku,
      isDraft = false,
      variantAxes: _variantAxes,
      name,
      description,
      price,
      stock,
      imageUrl,
      memberPrice,
      compareAtPrice,
      unitPriceAmount,
      unitPriceReference,
      fabric,
      care,
      sizeAgeGroup,
      vendor,
      tags,
      isActiveListing = true,
      productType = 'NEW',
    } = data;

    if (productType === 'REFURBISHED' && !isRefurbishedEnabled()) {
      throw new AppError(400, 'Refurbished products are temporarily disabled', 'REFURBISHED_DISABLED');
    }

    const category = await prisma.category.findUnique({
      where: { publicId: categoryPublicId },
      select: { id: true },
    });
    if (!category) {
      throw new AppError(404, 'Category not found');
    }

    const isVariantProduct = inventoryModel === 'variant_matrix' && variants.length > 0;

    const slugBase = (requestedSlug && String(requestedSlug).trim()) || slugifyName(name);
    const totalStock = isVariantProduct
      ? variants.reduce((sum, v) => sum + (v.stock ?? 0), 0)
      : stock;

    return prisma.$transaction(async (tx) => {
      const slug = await ensureUniqueSlug(tx, slugBase);

      let sku = incomingSku?.trim();
      if (isVariantProduct) {
        sku = await ensureUniqueParentSku(tx);
      } else {
        if (!sku) {
          sku = randomSku(isDraft ? 'DRAFT' : 'SKU');
          for (let i = 0; i < 20; i += 1) {
            const taken = await tx.product.findUnique({ where: { sku }, select: { id: true } });
            if (!taken) break;
            sku = randomSku(isDraft ? 'DRAFT' : 'SKU');
          }
        } else {
          const taken = await tx.product.findUnique({ where: { sku }, select: { id: true } });
          if (taken) {
            throw new AppError(400, 'Product with this SKU already exists');
          }
        }
      }

      if (isVariantProduct) {
        const seen = new Set();
        for (const v of variants) {
          if (seen.has(v.sku)) {
            throw new AppError(400, 'Duplicate variant SKU in payload');
          }
          seen.add(v.sku);
          const clash = await tx.product.findUnique({ where: { sku: v.sku }, select: { id: true } });
          if (clash) {
            throw new AppError(400, `Variant SKU "${v.sku}" conflicts with another product`);
          }
        }
      }

      const normalizedImageUrl = normalizeMediaUrl(imageUrl);

      const normalizedGallery =
        gallery === null || gallery === undefined
          ? undefined
          : Array.isArray(gallery) && gallery.length === 0
            ? Prisma.JsonNull
            : Array.isArray(gallery)
              ? gallery.map((g) => {
                  if (!g || typeof g !== 'object') return g;
                  const anyG = g;
                  if (typeof anyG.url === 'string') {
                    return { ...anyG, url: normalizeMediaUrl(anyG.url) || anyG.url };
                  }
                  return g;
                })
              : gallery;

      const product = await tx.product.create({
        data: {
          name,
          slug,
          description: description ?? null,
          price,
          stock: totalStock,
          categoryId: category.id,
          imageUrl: normalizedImageUrl,
          sku,
          memberPrice: memberPrice ?? null,
          compareAtPrice: compareAtPrice ?? null,
          unitPriceAmount: unitPriceAmount ?? null,
          unitPriceReference: unitPriceReference ?? null,
          fabric: fabric ?? null,
          care: care ?? null,
          sizeAgeGroup: sizeAgeGroup ?? null,
          vendor: vendor ?? null,
          tags: tags ?? null,
          isDraft,
          isActiveListing,
          inventoryModel,
          productType,
          gallery: normalizedGallery,
          variants: isVariantProduct
            ? {
                create: variants.map((v, i) => ({
                  combination: v.combination,
                  sku: v.sku,
                  stock: v.stock,
                  priceOverride: v.priceOverride ?? null,
                  imageUrl: normalizeMediaUrl(v.imageUrl),
                  sortOrder: i,
                })),
              }
            : undefined,
        },
        include: { category: true, variants: { orderBy: { sortOrder: 'asc' } } },
      });

      return product;
    });
  }

  async updateProduct(publicId, data) {
    const product = await prisma.product.findUnique({
      where: { publicId },
      include: { variants: true },
    });

    if (!product) {
      throw new AppError(404, 'Product not found');
    }

    const { isRefurbishedEnabled } = await import('../config/feature-flags.js');
    if (data.productType === 'REFURBISHED' && !isRefurbishedEnabled()) {
      throw new AppError(400, 'Refurbished products are temporarily disabled', 'REFURBISHED_DISABLED');
    }

    const {
      categoryId: categoryPublicId,
      variants: variantsPayload,
      variantAxes: _variantAxes,
      gallery,
      imageUrl,
      ...rest
    } = data;

    const hasVariantsKey = Object.prototype.hasOwnProperty.call(data, 'variants');
    const incomingVariants = hasVariantsKey ? variantsPayload ?? [] : null;

    return prisma.$transaction(async (tx) => {
      const updatePayload = { ...rest };

      if (imageUrl !== undefined) {
        updatePayload.imageUrl = normalizeMediaUrl(imageUrl);
      }

      if (gallery !== undefined) {
        updatePayload.gallery =
          gallery === null || (Array.isArray(gallery) && gallery.length === 0)
            ? Prisma.JsonNull
            : Array.isArray(gallery)
              ? gallery.map((g) => {
                  if (!g || typeof g !== 'object') return g;
                  const anyG = g;
                  if (typeof anyG.url === 'string') {
                    return { ...anyG, url: normalizeMediaUrl(anyG.url) || anyG.url };
                  }
                  return g;
                })
              : gallery;
      }

      if (categoryPublicId !== undefined) {
        const category = await tx.category.findUnique({
          where: { publicId: categoryPublicId },
          select: { id: true },
        });
        if (!category) {
          throw new AppError(404, 'Category not found');
        }
        updatePayload.categoryId = category.id;
      }

      if (updatePayload.sku !== undefined && updatePayload.sku !== null) {
        const other = await tx.product.findFirst({
          where: { sku: updatePayload.sku, NOT: { id: product.id } },
          select: { id: true },
        });
        if (other) {
          throw new AppError(400, 'Product with this SKU already exists');
        }
      }

      if (updatePayload.slug !== undefined && updatePayload.slug !== null) {
        const s = String(updatePayload.slug).trim();
        if (!s) {
          throw new AppError(400, 'Slug cannot be empty');
        }
        const otherSlug = await tx.product.findFirst({
          where: { slug: s, NOT: { id: product.id } },
          select: { id: true },
        });
        if (otherSlug) {
          throw new AppError(400, 'Product with this slug already exists');
        }
        updatePayload.slug = s;
      }

      const inv =
        data.inventoryModel !== undefined ? data.inventoryModel : product.inventoryModel;

      if (hasVariantsKey) {
        await tx.productVariant.deleteMany({ where: { productId: product.id } });

        const isVariantProduct = inv === 'variant_matrix' && incomingVariants.length > 0;

        if (isVariantProduct) {
          const seen = new Set();
          for (const v of incomingVariants) {
            if (seen.has(v.sku)) {
              throw new AppError(400, 'Duplicate variant SKU in payload');
            }
            seen.add(v.sku);
            const clash = await tx.product.findFirst({
              where: { sku: v.sku, NOT: { id: product.id } },
              select: { id: true },
            });
            if (clash) {
              throw new AppError(400, `Variant SKU "${v.sku}" conflicts with another product`);
            }
          }

          const wasVariant =
            product.inventoryModel === 'variant_matrix' && product.variants.length > 0;

          updatePayload.stock = incomingVariants.reduce((sum, v) => sum + v.stock, 0);
          updatePayload.inventoryModel = 'variant_matrix';

          if (!wasVariant) {
            updatePayload.sku = await ensureUniqueParentSku(tx);
          }

          return tx.product.update({
            where: { id: product.id },
            data: {
              ...updatePayload,
              variants: {
                create: incomingVariants.map((v, i) => ({
                  combination: v.combination,
                  sku: v.sku,
                  stock: v.stock,
                  priceOverride: v.priceOverride ?? null,
                  imageUrl: normalizeMediaUrl(v.imageUrl),
                  sortOrder: i,
                })),
              },
            },
            include: { category: true, variants: { orderBy: { sortOrder: 'asc' } } },
          });
        }

        updatePayload.inventoryModel = 'simple';
        if (data.stock !== undefined) {
          updatePayload.stock = data.stock;
        }

        return tx.product.update({
          where: { id: product.id },
          data: updatePayload,
          include: { category: true, variants: { orderBy: { sortOrder: 'asc' } } },
        });
      }

      return tx.product.update({
        where: { id: product.id },
        data: updatePayload,
        include: { category: true, variants: { orderBy: { sortOrder: 'asc' } } },
      });
    });
  }

  async deleteProduct(publicId) {
    const product = await prisma.product.findUnique({ where: { publicId } });

    if (!product) {
      throw new AppError(404, 'Product not found');
    }

    return prisma.product.delete({ where: { id: product.id } });
  }
}

export const productService = new ProductService();
