import { Router } from 'express';
import { orderController } from '../controllers/order.controller.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { requireConsoleModule } from '../middleware/admin-console.js';

const router = Router();

router.get('/', authenticate, (req, res, next) => orderController.getUserOrders(req, res).catch(next));
router.post('/', authenticate, (req, res, next) => orderController.createOrder(req, res).catch(next));
router.post('/quote', authenticate, (req, res, next) => orderController.getCheckoutQuote(req, res).catch(next));

router.get(
  '/admin/all',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  requireConsoleModule('orders'),
  (req, res, next) => orderController.getAllOrders(req, res).catch(next)
);
router.get(
  '/admin/stats',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  requireConsoleModule('orders'),
  (req, res, next) => orderController.getAdminOrderStats(req, res).catch(next)
);
router.post(
  '/admin/:id/shipping-options',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  requireConsoleModule('orders'),
  (req, res, next) => orderController.getAdminShippingOptions(req, res).catch(next)
);
router.post(
  '/admin/:id/shipping-label',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  requireConsoleModule('orders'),
  (req, res, next) => orderController.generateAdminShippingLabel(req, res).catch(next)
);
router.post(
  '/admin/:id/return-options',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  requireConsoleModule('orders'),
  (req, res, next) => orderController.getAdminReturnShippingOptions(req, res).catch(next)
);
router.post(
  '/admin/:id/return-label',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  requireConsoleModule('orders'),
  (req, res, next) => orderController.generateAdminReturnLabel(req, res).catch(next)
);
router.get(
  '/admin/:id',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  requireConsoleModule('orders'),
  (req, res, next) => orderController.getOrderAdmin(req, res).catch(next)
);
router.patch(
  '/:id/status',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  requireConsoleModule('orders'),
  (req, res, next) => orderController.updateOrderStatus(req, res).catch(next)
);
router.patch(
  '/:id/refund',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  requireConsoleModule('orders'),
  (req, res, next) => orderController.refundOrder(req, res).catch(next)
);
router.patch(
  '/:id/shipping',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  requireConsoleModule('orders'),
  (req, res, next) => orderController.updateAdminShipping(req, res).catch(next)
);
router.patch(
  '/:id/cancellation-review',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  requireConsoleModule('orders'),
  (req, res, next) => orderController.reviewCancellation(req, res).catch(next)
);
router.patch('/:id/cancel', authenticate, (req, res, next) =>
  orderController.cancelMyOrder(req, res).catch(next)
);
router.patch(
  '/:id/tracking',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  requireConsoleModule('orders'),
  (req, res, next) => orderController.updateTracking(req, res).catch(next)
);
router.get('/:id', authenticate, (req, res, next) =>
  orderController.getOrderById(req, res).catch(next)
);

export default router;
