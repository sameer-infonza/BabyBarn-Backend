import { PrismaClient } from '@prisma/client';
import { AppError } from '../utils/error-handler.js';

const prisma = new PrismaClient();

export class CategoryService {
  async getAllCategories() {
    return prisma.category.findMany({
      include: { _count: { select: { products: true } } },
    });
  }

  async getCategoryById(publicId) {
    const category = await prisma.category.findUnique({
      where: { publicId },
      include: { products: true },
    });

    if (!category) {
      throw new AppError(404, 'Category not found');
    }

    return category;
  }

  async createCategory(data) {
    return prisma.category.create({ data });
  }

  async updateCategory(publicId, data) {
    const category = await prisma.category.findUnique({ where: { publicId } });

    if (!category) {
      throw new AppError(404, 'Category not found');
    }

    return prisma.category.update({
      where: { id: category.id },
      data,
    });
  }

  async deleteCategory(publicId) {
    const category = await prisma.category.findUnique({ where: { publicId } });

    if (!category) {
      throw new AppError(404, 'Category not found');
    }

    return prisma.category.delete({ where: { id: category.id } });
  }
}

export const categoryService = new CategoryService();
