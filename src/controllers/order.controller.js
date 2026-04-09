import { orderService } from '../services/order.service.js';
import { validate } from '../utils/validation.js';
import { createOrderSchema } from '../schemas/index.js';

export class OrderController {
  async getUserOrders(req, res) {
    const page = parseInt(String(req.query.page), 10) || 1;
    const limit = parseInt(String(req.query.limit), 10) || 10;

    const result = await orderService.getUserOrders(req.user.id, page, limit);

    res.status(200).json({
      success: true,
      data: result,
    });
  }

  async getOrderById(req, res) {
    const { id } = req.params;
    const order = await orderService.getOrderById(id, req.user.id);

    res.status(200).json({
      success: true,
      data: order,
    });
  }

  async createOrder(req, res) {
    const data = await validate(createOrderSchema, req.body);
    const order = await orderService.createOrder(req.user.id, data.items);

    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      data: order,
    });
  }

  async getAllOrders(req, res) {
    const page = parseInt(String(req.query.page), 10) || 1;
    const limit = parseInt(String(req.query.limit), 10) || 20;

    const result = await orderService.getAllOrders(page, limit);

    res.status(200).json({
      success: true,
      data: result,
    });
  }

  async updateOrderStatus(req, res) {
    const { id } = req.params;
    const { status } = req.body;

    const order = await orderService.updateOrderStatus(id, status);

    res.status(200).json({
      success: true,
      message: 'Order status updated successfully',
      data: order,
    });
  }
}

export const orderController = new OrderController();
