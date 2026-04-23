/** Route-level module slugs used by middleware on concrete API routes. */
export const ADMIN_CONSOLE_ROUTE_MODULES = [
  'dashboard',
  'categories',
  'products',
  'refurbished',
  'inventory',
  'orders',
  'returns',
  'inspection',
  'store-credit',
  'access',
  'customers',
  'finance',
  'team',
  'activity',
  'profile',
];

/** Business-facing team permission modules (coarse-grained, no granular permissions). */
export const TEAM_PERMISSION_MODULES = [
  'product-management',
  'inventory-management',
  'order-management',
  'returns-refurbishment',
  'finance-management',
  'membership-management',
  'user-management',
];

export const TEAM_PERMISSION_TO_ROUTE_MODULES = {
  'product-management': ['categories', 'products', 'refurbished'],
  'inventory-management': ['inventory', 'inspection'],
  'order-management': ['orders'],
  'returns-refurbishment': ['returns'],
  'finance-management': ['finance', 'store-credit', 'activity'],
  'membership-management': ['access'],
  'user-management': ['customers'],
};

export function isValidRouteModule(slug) {
  return typeof slug === 'string' && ADMIN_CONSOLE_ROUTE_MODULES.includes(slug);
}

export function isValidTeamPermissionModule(slug) {
  return typeof slug === 'string' && TEAM_PERMISSION_MODULES.includes(slug);
}

export function normalizeTeamPermissionModules(modules) {
  if (modules == null) return null;
  if (!Array.isArray(modules)) return [];
  return [...new Set(modules.filter((m) => isValidTeamPermissionModule(m)))];
}

export function canAccessRouteModule(assignedModules, routeModule) {
  if (assignedModules == null) return true;
  if (!Array.isArray(assignedModules)) return false;
  if (assignedModules.length === 0) return false;
  if (assignedModules.includes(routeModule)) return true;
  return assignedModules.some((teamModule) =>
    (TEAM_PERMISSION_TO_ROUTE_MODULES[teamModule] || []).includes(routeModule)
  );
}
