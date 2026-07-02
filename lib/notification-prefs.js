/** Shared notification preference defaults for customers and admin/team users. */
export function normalizeNotificationPrefs(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    returnReminders: source.returnReminders !== false,
    restockAlerts: source.restockAlerts !== false,
    accessDrops: source.accessDrops === true,
    lowStockAlerts: source.lowStockAlerts !== false,
    newOrders: source.newOrders !== false,
    returnRequests: source.returnRequests !== false,
    teamDigest: source.teamDigest === true,
    accessRenewals: source.accessRenewals !== false,
  };
}
