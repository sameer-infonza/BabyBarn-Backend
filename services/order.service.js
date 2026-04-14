import { PrismaClient } from '@prisma/client';
import { AppError } from '../utils/error-handler.js';
import {
  assertAndDecrementOrderStock,
  assertStockAvailable,
  syncParentStockFromVariants,
} from './inventory.service.js';

const prisma = new PrismaClient();

const userForOrderList = {
  select: {
    id: true,
    publicId: true,
    email: true,
    firstName: true,
    lastName: true,
    role: { select: { name: true } },
  },
};

export class OrderService {
  async getUserOrders(userPublicId, page = 1, limit = 10) {
    const user = await prisma.user.findUnique({
      where: { publicId: userPublicId },
      select: { id: true },
    });
    if (!user) {
      throw new AppError(401, 'Unauthorized');
    }

    const skip = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where: { userId: user.id },
        skip,
        take: limit,
        include: { orderItems: { include: { product: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.order.count({ where: { userId: user.id } }),
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

  async getOrderById(orderPublicId, userPublicId) {
    const [order, viewer] = await Promise.all([
      prisma.order.findUnique({
        where: { publicId: orderPublicId },
        include: { orderItems: { include: { product: true } } },
      }),
      prisma.user.findUnique({
        where: { publicId: userPublicId },
        select: { id: true },
      }),
    ]);

    if (!order) {
      throw new AppError(404, 'Order not found');
    }
    if (!viewer) {
      throw new AppError(401, 'Unauthorized');
    }
    if (order.userId !== viewer.id) {
      throw new AppError(403, 'Unauthorized to access this order');
    }

    return order;
  }

  async createOrder(userPublicId, items) {
    const user = await prisma.user.findUnique({
      where: { publicId: userPublicId },
      select: { id: true },
    });
    if (!user) {
      throw new AppError(401, 'Unauthorized');
    }

    let totalAmount = 0;

    return prisma.$transaction(async (tx) => {
      const products = [];
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        const product = await tx.product.findUnique({
          where: { publicId: item.productId },
          include: { variants: { orderBy: { sortOrder: 'asc' } } },
        });
        if (!product) {
          throw new AppError(404, `Product not found for item ${index + 1}`);
        }
        totalAmount += product.price * item.quantity;
        products.push(product);
      }

      for (let index = 0; index < items.length; index += 1) {
        await assertAndDecrementOrderStock(tx, products[index], items[index].quantity);
      }

      const order = await tx.order.create({
        data: {
          userId: user.id,
          totalAmount,
          paymentStatus: 'PAID',
          orderItems: {
            create: items.map((item, index) => ({
              productId: products[index].id,
              quantity: item.quantity,
              price: products[index].price,
            })),
          },
        },
        include: { orderItems: { include: { product: true } } },
      });

      return order;
    });
  }

  /**
   * Unpaid order for Stripe Checkout — stock validated but not decremented until webhook payment success.
   */
  async createPendingOrderForStripe(userPublicId, items) {
    const user = await prisma.user.findUnique({
      where: { publicId: userPublicId },
      select: { id: true },
    });
    if (!user) {
      throw new AppError(401, 'Unauthorized');
    }

    let totalAmount = 0;

    return prisma.$transaction(async (tx) => {
      const products = [];
      const lineCreates = [];
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        const product = await tx.product.findUnique({
          where: { publicId: item.productId },
          include: { variants: { orderBy: { sortOrder: 'asc' } } },
        });
        if (!product) {
          throw new AppError(404, `Product not found for item ${index + 1}`);
        }
        if (product.isDraft || !product.isActiveListing) {
          throw new AppError(400, `Product "${product.name}" is not available`);
        }

        let unitPrice = product.price;
        let variantDbId = null;

        if (item.variantId) {
          const v = product.variants.find((x) => x.publicId === item.variantId);
          if (!v) {
            throw new AppError(404, `Variant not found for item ${index + 1}`);
          }
          if (v.stock < item.quantity) {
            throw new AppError(400, `Insufficient stock for "${product.name}"`);
          }
          unitPrice = v.priceOverride != null ? v.priceOverride : product.price;
          variantDbId = v.id;
        } else {
          assertStockAvailable(product, item.quantity);
        }

        totalAmount += unitPrice * item.quantity;
        products.push(product);
        lineCreates.push({
          productId: product.id,
          productVariantId: variantDbId,
          quantity: item.quantity,
          price: unitPrice,
        });
      }

      const order = await tx.order.create({
        data: {
          userId: user.id,
          totalAmount,
          paymentStatus: 'UNPAID',
          status: 'PENDING',
          orderItems: {
            create: lineCreates,
          },
        },
        include: { orderItems: { include: { product: true } } },
      });

      return order;
    });
  }

  async fulfillUnpaidOrderAfterPayment(orderPublicId) {
    return prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { publicId: orderPublicId },
        include: { orderItems: true },
      });
      if (!order) {
        throw new AppError(404, 'Order not found');
      }
      if (order.paymentStatus === 'PAID') {
        return order;
      }

      for (const line of order.orderItems) {
        const product = await tx.product.findUnique({
          where: { id: line.productId },
          include: { variants: { orderBy: { sortOrder: 'asc' } } },
        });
        if (line.productVariantId) {
          const v = await tx.productVariant.findUnique({
            where: { id: line.productVariantId },
          });
          if (!v || v.stock < line.quantity) {
            throw new AppError(400, `Insufficient stock for "${product.name}"`);
          }
          await tx.productVariant.update({
            where: { id: v.id },
            data: { stock: v.stock - line.quantity },
          });
          await syncParentStockFromVariants(tx, product.id);
        } else {
          await assertAndDecrementOrderStock(tx, product, line.quantity);
        }
      }

      return tx.order.update({
        where: { id: order.id },
        data: { paymentStatus: 'PAID', status: 'PROCESSING' },
        include: { orderItems: { include: { product: true } } },
      });
    });
  }

  async updateOrderStatus(orderPublicId, status) {
    const order = await prisma.order.findUnique({
      where: { publicId: orderPublicId },
    });

    if (!order) {
      throw new AppError(404, 'Order not found');
    }

    return prisma.order.update({
      where: { id: order.id },
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
          user: userForOrderList,
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
