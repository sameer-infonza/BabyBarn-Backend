import { AppError } from '../utils/error-handler.js';
import { isValidRouteModule, canAccessRouteModule } from '../constants/admin-modules.js';

/**
 * After authenticate + authorize('ADMIN','ADMIN_TEAM').
 * ADMIN: always allowed.
 * ADMIN_TEAM: deny-by-default. null/undefined/empty modules only grant the
 * always-allowed slugs (dashboard/profile/notifications); an array grants those
 * slugs plus the mapped route modules.
 */
function checkConsoleModuleAccess(user, moduleSlug) {
  const { role, adminModules } = user || {};
  if (role === 'ADMIN') return true;
  if (role !== 'ADMIN_TEAM') return false;
  const alwaysAllowed = moduleSlug === 'dashboard' || moduleSlug === 'profile' || moduleSlug === 'notifications';
  if (adminModules === null || adminModules === undefined) return alwaysAllowed;
  if (!Array.isArray(adminModules)) return false;
  if (adminModules.length === 0) return alwaysAllowed;
  return alwaysAllowed || canAccessRouteModule(adminModules, moduleSlug);
}

export function requireConsoleModule(moduleSlug) {
  return (req, res, next) => {
    if (!isValidRouteModule(moduleSlug)) {
      next(new AppError(500, 'Invalid server route module configuration'));
      return;
    }
    try {
      if (!req.user) {
        next(new AppError(403, 'Forbidden'));
        return;
      }
      if (checkConsoleModuleAccess(req.user, moduleSlug)) {
        next();
        return;
      }
      next(new AppError(403, 'Forbidden'));
    } catch (e) {
      next(e);
    }
  };
}

/** Allow ADMIN_TEAM with any of the listed route modules (e.g. inspection + returns). */
export function requireConsoleModuleAny(moduleSlugs) {
  const slugs = Array.isArray(moduleSlugs) ? moduleSlugs : [moduleSlugs];
  return (req, res, next) => {
    for (const slug of slugs) {
      if (!isValidRouteModule(slug)) {
        next(new AppError(500, 'Invalid server route module configuration'));
        return;
      }
    }
    try {
      if (!req.user) {
        next(new AppError(403, 'Forbidden'));
        return;
      }
      if (slugs.some((slug) => checkConsoleModuleAccess(req.user, slug))) {
        next();
        return;
      }
      next(new AppError(403, 'Forbidden'));
    } catch (e) {
      next(e);
    }
  };
}
