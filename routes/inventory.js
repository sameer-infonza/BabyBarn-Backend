import { Router } from 'express';
import { inventoryController } from '../controllers/inventory.controller.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = Router();

router.get('/stats', authenticate, authorize('ADMIN', 'ADMIN_TEAM'), (req, res, next) =>
  inventoryController.getStats(req, res).catch(next)
);

router.get('/', authenticate, authorize('ADMIN', 'ADMIN_TEAM'), (req, res, next) =>
  inventoryController.list(req, res).catch(next)
);

router.get('/history', authenticate, authorize('ADMIN', 'ADMIN_TEAM'), (req, res, next) =>
  inventoryController.history(req, res).catch(next)
);

router.post('/adjust', authenticate, authorize('ADMIN', 'ADMIN_TEAM'), (req, res, next) =>
  inventoryController.adjust(req, res).catch(next)
);

router.patch('/products/:id/type', authenticate, authorize('ADMIN', 'ADMIN_TEAM'), (req, res, next) =>
  inventoryController.updateProductType(req, res).catch(next)
);

export default router;
