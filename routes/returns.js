import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { requireConsoleModule } from '../middleware/admin-console.js';
import { returnsController } from '../controllers/returns.controller.js';

const router = Router();

router.get(
  '/admin/all',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  requireConsoleModule('returns'),
  (req, res, next) => returnsController.listAll(req, res).catch(next)
);
router.get('/', authenticate, (req, res, next) => returnsController.listMine(req, res).catch(next));
router.post('/', authenticate, (req, res, next) => returnsController.create(req, res).catch(next));
router.patch(
  '/:id/status',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  requireConsoleModule('returns'),
  (req, res, next) => returnsController.updateStatus(req, res).catch(next)
);

export default router;
