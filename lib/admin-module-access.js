import { canAccessRouteModule } from '../constants/admin-modules.js';

export function userCanSeeModule(user, moduleSlug) {
  if (!user) return false;
  if (user.role === 'ADMIN') return true;
  if (user.role !== 'ADMIN_TEAM') return false;
  const mods = user.adminModules;
  if (mods === null || mods === undefined) return true;
  if (!Array.isArray(mods)) return false;
  if (mods.length === 0) {
    return moduleSlug === 'dashboard' || moduleSlug === 'profile' || moduleSlug === 'notifications';
  }
  if (moduleSlug === 'dashboard' || moduleSlug === 'profile' || moduleSlug === 'notifications') {
    return true;
  }
  return canAccessRouteModule(mods, moduleSlug);
}
