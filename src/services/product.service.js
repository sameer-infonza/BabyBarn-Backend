import { PrismaClient } from '@prisma/client';
import { AppError } from '../utils/error-handler.js';

const prisma = new PrismaClient();

export class ProductService {
  async getAllProducts(page = 1, limit = 20, categoryId) {
    const skip = (page - 1) * limit;

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

  async getProductById(id) {
    const product = await prisma.product.findUnique({
      where: { id },
      include: { category: true },
    });

    if (!product) {
      throw new AppError(404, 'Product not found');
    }

    return product;
  }

  async createProduct(data) {
    const existingProduct = await prisma.product.findUnique({
      where: { sku: data.sku },
    });

    if (existingProduct) {
      throw new AppError(400, 'Product with this SKU already exists');
    }

    return prisma.product.create({
      data,
      include: { category: true },
    });
  }

  async updateProduct(id, data) {
    const product = await prisma.product.findUnique({ where: { id } });

    if (!product) {
      throw new AppError(404, 'Product not found');
    }

    return prisma.product.update({
      where: { id },
      data,
      include: { category: true },
    });
  }

  async deleteProduct(id) {
    const product = await prisma.product.findUnique({ where: { id } });

    if (!product) {
      throw new AppError(404, 'Product not found');
    }

    return prisma.product.delete({ where: { id } });
  }
}

export const productService = new ProductService();
