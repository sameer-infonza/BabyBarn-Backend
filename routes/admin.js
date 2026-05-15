import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { requireConsoleModule } from '../middleware/admin-console.js';
import { adminController } from '../controllers/admin.controller.js';
import { shippingAdminController } from '../controllers/shipping-admin.controller.js';

const router = Router();

router.get(
  '/finance/stats',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  requireConsoleModule('finance'),
  (req, res, next) => adminController.getFinanceStats(req, res).catch(next)
);
router.get(
  '/audit-logs',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  requireConsoleModule('activity'),
  (req, res, next) => adminController.listAuditLogs(req, res).catch(next)
);
router.get(
  '/customers',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  requireConsoleModule('customers'),
  (req, res, next) => adminController.listCustomers(req, res).catch(next)
);
router.get(
  '/customers/:id',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  requireConsoleModule('customers'),
  (req, res, next) => adminController.getCustomer(req, res).catch(next)
);
router.patch(
  '/customers/:id/active',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  requireConsoleModule('customers'),
  (req, res, next) => adminController.patchCustomerActive(req, res).catch(next)
);
router.get(
  '/access/members',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  requireConsoleModule('access'),
  (req, res, next) => adminController.listAccessMembers(req, res).catch(next)
);
router.get(
  '/settings/business',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  requireConsoleModule('access'),
  (req, res, next) => adminController.getBusinessSettings(req, res).catch(next)
);
router.patch(
  '/settings/business',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  requireConsoleModule('access'),
  (req, res, next) => adminController.patchBusinessSettings(req, res).catch(next)
);

router.get(
  '/shipping/config',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  requireConsoleModule('shipping'),
  (req, res, next) => shippingAdminController.getConfig(req, res).catch(next)
);
router.put(
  '/shipping/config',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  requireConsoleModule('shipping'),
  (req, res, next) => shippingAdminController.putConfig(req, res).catch(next)
);
router.post(
  '/shipping/services',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  requireConsoleModule('shipping'),
  (req, res, next) => shippingAdminController.createService(req, res).catch(next)
);
router.patch(
  '/shipping/services/:publicId',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  requireConsoleModule('shipping'),
  (req, res, next) => shippingAdminController.patchService(req, res).catch(next)
);
router.delete(
  '/shipping/services/:publicId',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  requireConsoleModule('shipping'),
  (req, res, next) => shippingAdminController.deleteService(req, res).catch(next)
);
router.get(
  '/shipping/logs',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  requireConsoleModule('shipping'),
  (req, res, next) => shippingAdminController.listLogs(req, res).catch(next)
);
router.post(
  '/shipping/test-ups',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  requireConsoleModule('shipping'),
  (req, res, next) => shippingAdminController.testUps(req, res).catch(next)
);

router.get('/team', authenticate, authorize('ADMIN'), (req, res, next) =>
  adminController.listTeam(req, res).catch(next)
);
router.post('/team', authenticate, authorize('ADMIN'), (req, res, next) =>
  adminController.createTeamMember(req, res).catch(next)
);
router.patch('/team/:id/modules', authenticate, authorize('ADMIN'), (req, res, next) =>
  adminController.patchTeamModules(req, res).catch(next)
);
router.patch('/team/:id', authenticate, authorize('ADMIN'), (req, res, next) =>
  adminController.updateTeamMember(req, res).catch(next)
);

export default router;
