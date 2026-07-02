import { Router } from 'express';
import { shippingController } from '../controllers/shipping.controller.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { requireConsoleModuleAny } from '../middleware/admin-console.js';

const router = Router();
const ordersOrShipping = requireConsoleModuleAny(['orders', 'shipping']);

router.post('/webhook/shippo', (req, res, next) =>
  shippingController.shippoWebhook(req, res).catch(next)
);

router.post('/rates', authenticate, (req, res, next) =>
  shippingController.getRates(req, res).catch(next)
);

router.post(
  '/debug-rate-check',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  ordersOrShipping,
  (req, res, next) => shippingController.debugRateCheck(req, res).catch(next)
);

router.post(
  '/shipments',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  ordersOrShipping,
  (req, res, next) => shippingController.createShipment(req, res).catch(next)
);

router.post(
  '/labels',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  ordersOrShipping,
  (req, res, next) => shippingController.generateLabel(req, res).catch(next)
);

router.get(
  '/track/:carrier/:trackingNumber',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  ordersOrShipping,
  (req, res, next) => shippingController.track(req, res).catch(next)
);

export default router;
