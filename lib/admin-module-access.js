import { canAccessRouteModule } from '../constants/admin-modules.js';

export function userCanSeeModule(user, moduleSlug) {
  if (!user) return false;
  if (user.role === 'ADMIN') return true;
  if (user.role !== 'ADMIN_TEAM') return false;

  // Inbox / alert emails require an explicit admin grant (not a business module slug).
  if (moduleSlug === 'notifications') {
    return user.adminNotificationAccess === true;
  }

  const mods = user.adminModules;
  const alwaysAllowed = moduleSlug === 'dashboard' || moduleSlug === 'profile';
  // Deny-by-default: null/undefined/empty modules only grant always-allowed slugs.
  if (mods === null || mods === undefined) return alwaysAllowed;
  if (!Array.isArray(mods)) return false;
  if (mods.length === 0) return alwaysAllowed;
  if (alwaysAllowed) return true;
  return canAccessRouteModule(mods, moduleSlug);
}
