import { PrismaClient } from '@prisma/client';
import { AppError } from '../utils/error-handler.js';

const prisma = new PrismaClient();

export class OrderService {
  async getUserOrders(userId, page = 1, limit = 10) {
    const skip = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where: { userId },
        skip,
        take: limit,
        include: { orderItems: { include: { product: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.order.count({ where: { userId } }),
    ]);

    return {
      orders,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async getOrderById(id, userId) {
    const order = await prisma.order.findUnique({
      where: { id },
      include: { orderItems: { include: { product: true } } },
    });

    if (!order) {
      throw new AppError(404, 'Order not found');
    }

    if (order.userId !== userId) {
      throw new AppError(403, 'Unauthorized to access this order');
    }

    return order;
  }

  async createOrder(userId, items) {
    let totalAmount = 0;

    const products = await Promise.all(
      items.map((item) => prisma.product.findUnique({ where: { id: item.productId } }))
    );

    products.forEach((product, index) => {
      if (!product) {
        throw new AppError(404, `Product not found for item ${index + 1}`);
      }
      totalAmount += product.price * items[index].quantity;
    });

    const order = await prisma.order.create({
      data: {
        userId,
        totalAmount,
        orderItems: {
          create: items.map((item, index) => ({
            productId: item.productId,
            quantity: item.quantity,
            price: products[index].price,
          })),
        },
      },
      include: { orderItems: { include: { product: true } } },
    });

    return order;
  }

  async updateOrderStatus(id, status) {
    const order = await prisma.order.findUnique({ where: { id } });

    if (!order) {
      throw new AppError(404, 'Order not found');
    }

    return prisma.order.update({
      where: { id },
      data: { status },
      include: { orderItems: { include: { product: true } } },
    });
  }

  async getAllOrders(page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        skip,
        take: limit,
        include: {
          orderItems: { include: { product: true } },
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              role: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.order.count(),
    ]);

    return {
      orders,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }
}

export const orderService = new OrderService();
