import { orderService } from '../services/order.service.js';
import { validate } from '../utils/validation.js';
import {
  createOrderSchema,
  checkoutQuoteSchema,
  trackingUpdateSchema,
  orderStatusUpdateSchema,
  adminShippingUpdateSchema,
  adminShippingOptionsSchema,
  adminGenerateLabelSchema,
  cancelOrderRequestSchema,
  orderCancellationReviewSchema,
} from '../schemas/index.js';
import { toPublicJson } from '../utils/serialize.js';

function adminActor(req) {
  return { id: req.user?.id, email: req.user?.email };
}

export class OrderController {
  async getUserOrders(req, res) {
    const page = parseInt(String(req.query.page), 10) || 1;
    const limit = parseInt(String(req.query.limit), 10) || 10;

    const result = await orderService.getUserOrders(req.user.id, page, limit);

    res.status(200).json({
      success: true,
      data: toPublicJson(result),
    });
  }

  async getCheckoutQuote(req, res) {
    const body = await validate(checkoutQuoteSchema, req.body);
    const data = await orderService.calculateCheckoutQuote(req.user.id, body);
    res.status(200).json({ success: true, data: toPublicJson(data) });
  }

  async getOrderById(req, res) {
    const { id } = req.params;
    const order = await orderService.getOrderById(id, req.user.id);

    res.status(200).json({
      success: true,
      data: toPublicJson(order),
    });
  }

  async createOrder(req, res) {
    const data = await validate(createOrderSchema, req.body);
    const order = await orderService.createOrder(req.user.id, data.items);

    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      data: toPublicJson(order),
    });
  }

  async getAllOrders(req, res) {
    const page = parseInt(String(req.query.page), 10) || 1;
    const limit = parseInt(String(req.query.limit), 10) || 20;
    const search = req.query.search ? String(req.query.search) : undefined;
    const status = req.query.status ? String(req.query.status) : undefined;
    const dateFrom = req.query.dateFrom ? String(req.query.dateFrom) : undefined;
    const dateTo = req.query.dateTo ? String(req.query.dateTo) : undefined;
    const cancellationReviewStatus = req.query.cancellationReviewStatus
      ? String(req.query.cancellationReviewStatus)
      : undefined;

    const sortBy = req.query.sortBy ? String(req.query.sortBy) : undefined;
    const sortOrder = req.query.sortOrder ? String(req.query.sortOrder) : undefined;
    const membershipFilter = req.query.membershipFilter
      ? String(req.query.membershipFilter)
      : undefined;
    const statusGroup = req.query.statusGroup ? String(req.query.statusGroup) : undefined;

    const result = await orderService.getAllOrders(page, limit, {
      search,
      status,
      statusGroup,
      dateFrom,
      dateTo,
      cancellationReviewStatus,
      membershipFilter,
      sortBy,
      sortOrder,
    });

    res.status(200).json({
      success: true,
      data: toPublicJson(result),
    });
  }

  async getAdminOrderStats(req, res) {
    const data = await orderService.getAdminOrderStats();
    res.status(200).json({ success: true, data: toPublicJson(data) });
  }

  async getOrderAdmin(req, res) {
    const { id } = req.params;
    const order = await orderService.getOrderForAdmin(id);
    res.status(200).json({
      success: true,
      data: toPublicJson(order),
    });
  }

  async updateOrderStatus(req, res) {
    const { id } = req.params;
    const { status } = await validate(orderStatusUpdateSchema, req.body);

    const order = await orderService.updateOrderStatus(id, status, adminActor(req));

    res.status(200).json({
      success: true,
      message: 'Order status updated successfully',
      data: toPublicJson(order),
    });
  }

  async refundOrder(req, res) {
    const { id } = req.params;
    const order = await orderService.refundOrder(id, adminActor(req));
    res.status(200).json({
      success: true,
      message: 'Order marked as refunded',
      data: toPublicJson(order),
    });
  }

  async updateAdminShipping(req, res) {
    const { id } = req.params;
    const body = await validate(adminShippingUpdateSchema, req.body);
    const order = await orderService.updateAdminShipping(id, body);
    res.status(200).json({ success: true, data: toPublicJson(order) });
  }

  async updateTracking(req, res) {
    const { id } = req.params;
    const body = await validate(trackingUpdateSchema, req.body);
    const order = await orderService.addTracking(id, body);
    res.status(200).json({ success: true, data: toPublicJson(order) });
  }

  async getAdminShippingOptions(req, res) {
    const { id } = req.params;
    const body = await validate(adminShippingOptionsSchema, req.body ?? {});
    const data = await orderService.getAdminShippingOptions(id, body);
    res.status(200).json({ success: true, data: toPublicJson(data) });
  }

  async generateAdminShippingLabel(req, res) {
    const { id } = req.params;
    const body = await validate(adminGenerateLabelSchema, req.body ?? {});
    const data = await orderService.generateAdminShippingLabel(id, body, adminActor(req));
    res.status(200).json({ success: true, data: toPublicJson(data) });
  }

  async getAdminReturnShippingOptions(req, res) {
    const { id } = req.params;
    const body = await validate(adminShippingOptionsSchema, req.body ?? {});
    const data = await orderService.getAdminReturnShippingOptions(id, body);
    res.status(200).json({ success: true, data: toPublicJson(data) });
  }

  async generateAdminReturnLabel(req, res) {
    const { id } = req.params;
    const body = await validate(adminGenerateLabelSchema, req.body ?? {});
    const data = await orderService.generateAdminReturnLabel(id, body, adminActor(req));
    res.status(200).json({ success: true, data: toPublicJson(data) });
  }

  async cancelMyOrder(req, res) {
    const { id } = req.params;
    const body = await validate(cancelOrderRequestSchema, req.body ?? {});
    const order = await orderService.requestCancellationByUser(id, req.user.id, body.reason);
    res.status(200).json({
      success: true,
      message: 'Cancellation request submitted. Our team will review it shortly.',
      data: toPublicJson(order),
    });
  }

  async reviewCancellation(req, res) {
    const { id } = req.params;
    const body = await validate(orderCancellationReviewSchema, req.body);
    const order = await orderService.reviewCancellationOrder(id, body, adminActor(req));
    res.status(200).json({
      success: true,
      message: `Cancellation ${body.decision === 'approve' ? 'approved' : 'rejected'}`,
      data: toPublicJson(order),
    });
  }
}

export const orderController = new OrderController();
