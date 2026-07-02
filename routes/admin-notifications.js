import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { requireConsoleModule } from '../middleware/admin-console.js';
import { adminNotificationController } from '../controllers/admin-notification.controller.js';

const router = Router();

router.get(
  '/',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  requireConsoleModule('notifications'),
  (req, res, next) => adminNotificationController.list(req, res).catch(next)
);

router.get(
  '/unread-count',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  requireConsoleModule('notifications'),
  (req, res, next) => adminNotificationController.unreadCount(req, res).catch(next)
);

router.get(
  '/recent',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  requireConsoleModule('notifications'),
  (req, res, next) => adminNotificationController.recent(req, res).catch(next)
);

router.patch(
  '/:publicId/read',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  requireConsoleModule('notifications'),
  (req, res, next) => adminNotificationController.markRead(req, res).catch(next)
);

router.post(
  '/read-all',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  requireConsoleModule('notifications'),
  (req, res, next) => adminNotificationController.markAllRead(req, res).catch(next)
);

export default router;
