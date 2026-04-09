import { Router } from 'express';
import { orderController } from '../controllers/order.controller.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = Router();

router.get('/', authenticate, (req, res, next) => orderController.getUserOrders(req, res).catch(next));
router.post('/', authenticate, (req, res, next) => orderController.createOrder(req, res).catch(next));

router.get('/admin/all', authenticate, authorize('ADMIN', 'ADMIN_TEAM'), (req, res, next) =>
  orderController.getAllOrders(req, res).catch(next)
);
router.patch('/:id/status', authenticate, authorize('ADMIN', 'ADMIN_TEAM'), (req, res, next) =>
  orderController.updateOrderStatus(req, res).catch(next)
);
router.get('/:id', authenticate, (req, res, next) =>
  orderController.getOrderById(req, res).catch(next)
);

export default router;
