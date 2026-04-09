import { PrismaClient } from '@prisma/client';
import { AppError } from '../utils/error-handler.js';

const prisma = new PrismaClient();

export class CategoryService {
  async getAllCategories() {
    return prisma.category.findMany({
      include: { _count: { select: { products: true } } },
    });
  }

  async getCategoryById(id) {
    const category = await prisma.category.findUnique({
      where: { id },
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

  async updateCategory(id, data) {
    const category = await prisma.category.findUnique({ where: { id } });

    if (!category) {
      throw new AppError(404, 'Category not found');
    }

    return prisma.category.update({
      where: { id },
      data,
    });
  }

  async deleteCategory(id) {
    const category = await prisma.category.findUnique({ where: { id } });

    if (!category) {
      throw new AppError(404, 'Category not found');
    }

    return prisma.category.delete({ where: { id } });
  }
}

export const categoryService = new CategoryService();
