import { PrismaClient } from '@prisma/client';
import { AppError } from '../utils/error-handler.js';

const prisma = new PrismaClient();

export class ProductService {
  async getAllProducts(page = 1, limit = 20, categoryPublicId) {
    const skip = (page - 1) * limit;

    let categoryId;
    if (categoryPublicId) {
      const category = await prisma.category.findUnique({
        where: { publicId: categoryPublicId },
        select: { id: true },
      });
      if (!category) {
        throw new AppError(404, 'Category not found');
      }
      categoryId = category.id;
    }

    const where = categoryId ? { categoryId } : {};

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        skip,
        take: limit,
        include: { category: true },
      }),
      prisma.product.count({ where }),
    ]);

    return {
      products,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async getProductById(publicId) {
    const product = await prisma.product.findUnique({
      where: { publicId },
      include: { category: true },
    });

    if (!product) {
      throw new AppError(404, 'Product not found');
    }

    return product;
  }

  async createProduct(data) {
    const { categoryId: categoryPublicId, ...rest } = data;

    const category = await prisma.category.findUnique({
      where: { publicId: categoryPublicId },
      select: { id: true },
    });
    if (!category) {
      throw new AppError(404, 'Category not found');
    }

    const existingProduct = await prisma.product.findUnique({
      where: { sku: rest.sku },
    });

    if (existingProduct) {
      throw new AppError(400, 'Product with this SKU already exists');
    }

    return prisma.product.create({
      data: {
        ...rest,
        categoryId: category.id,
      },
      include: { category: true },
    });
  }

  async updateProduct(publicId, data) {
    const product = await prisma.product.findUnique({ where: { publicId } });

    if (!product) {
      throw new AppError(404, 'Product not found');
    }

    const { categoryId: categoryPublicId, ...rest } = data;
    const updatePayload = { ...rest };

    if (categoryPublicId !== undefined) {
      const category = await prisma.category.findUnique({
        where: { publicId: categoryPublicId },
        select: { id: true },
      });
      if (!category) {
        throw new AppError(404, 'Category not found');
      }
      updatePayload.categoryId = category.id;
    }

    return prisma.product.update({
      where: { id: product.id },
      data: updatePayload,
      include: { category: true },
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
