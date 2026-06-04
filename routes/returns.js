import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { requireConsoleModule, requireConsoleModuleAny } from '../middleware/admin-console.js';

const returnsOrInspection = requireConsoleModuleAny(['returns', 'inspection']);
import { returnsController } from '../controllers/returns.controller.js';

const router = Router();

router.get(
  '/refurbishment/jobs',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  returnsOrInspection,
  (req, res, next) => returnsController.listRefurbJobs(req, res).catch(next)
);
router.patch(
  '/refurbishment/:jobId/status',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  returnsOrInspection,
  (req, res, next) => returnsController.updateRefurbJobStatus(req, res).catch(next)
);
router.get(
  '/admin/all',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  returnsOrInspection,
  (req, res, next) => returnsController.listAll(req, res).catch(next)
);
router.get(
  '/admin/:id',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  requireConsoleModule('returns'),
  (req, res, next) => returnsController.getAdminById(req, res).catch(next)
);
router.get('/', authenticate, (req, res, next) => returnsController.listMine(req, res).catch(next));
router.get('/:id', authenticate, (req, res, next) => returnsController.getMineById(req, res).catch(next));
router.post('/', authenticate, (req, res, next) => returnsController.create(req, res).catch(next));
router.patch(
  '/:id/status',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  returnsOrInspection,
  (req, res, next) => returnsController.updateStatus(req, res).catch(next)
);

export default router;
