import { AppError } from '../utils/error-handler.js';
import { isValidRouteModule, canAccessRouteModule } from '../constants/admin-modules.js';

/**
 * After authenticate + authorize('ADMIN','ADMIN_TEAM').
 * ADMIN: always allowed.
 * ADMIN_TEAM: adminModules null/undefined = all modules; array = only those slugs (+ dashboard/profile always).
 */
export function requireConsoleModule(moduleSlug) {
  return (req, res, next) => {
    if (!isValidRouteModule(moduleSlug)) {
      next(new AppError(500, 'Invalid server route module configuration'));
      return;
    }
    try {
      const { role, adminModules } = req.user || {};
      if (role === 'ADMIN') {
        next();
        return;
      }
      if (role !== 'ADMIN_TEAM') {
        next(new AppError(403, 'Forbidden'));
        return;
      }
      if (adminModules === null || adminModules === undefined) {
        next();
        return;
      }
      if (!Array.isArray(adminModules)) {
        next(new AppError(403, 'Forbidden'));
        return;
      }
      if (adminModules.length === 0) {
        next(new AppError(403, 'No console modules assigned'));
        return;
      }
      const alwaysAllowed = moduleSlug === 'dashboard' || moduleSlug === 'profile';
      if (alwaysAllowed || canAccessRouteModule(adminModules, moduleSlug)) {
        next();
        return;
      }
      next(new AppError(403, 'Forbidden'));
    } catch (e) {
      next(e);
    }
  };
}
