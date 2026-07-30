import { prisma } from '../lib/prisma.js';
import { userCanSeeModule } from '../lib/admin-module-access.js';
import { normalizeNotificationPrefs } from '../lib/notification-prefs.js';

/**
 * Resolve admin/team email recipients for operational alerts.
 * @param {{ module: string; prefKey?: keyof ReturnType<typeof normalizeNotificationPrefs> }} options
 */
export async function resolveAdminNotificationRecipients({ module, prefKey }) {
  const roles = await prisma.role.findMany({
    where: { name: { in: ['ADMIN', 'ADMIN_TEAM'] } },
    select: { id: true },
  });
  if (!roles.length) return [];

  const users = await prisma.user.findMany({
    where: {
      roleId: { in: roles.map((r) => r.id) },
      isActive: true,
    },
    select: {
      email: true,
      firstName: true,
      lastName: true,
      notificationPrefs: true,
      adminModules: true,
      adminNotificationAccess: true,
      role: { select: { name: true } },
    },
  });

  const seen = new Set();
  const recipients = [];

  for (const user of users) {
    const prefs = normalizeNotificationPrefs(user.notificationPrefs);
    if (prefKey && prefs[prefKey] === false) continue;

    const roleName = user.role?.name;
    // Operational emails require an explicit grant for team members (ADMIN always eligible).
    if (roleName === 'ADMIN_TEAM' && !user.adminNotificationAccess) {
      continue;
    }
    if (
      !userCanSeeModule(
        {
          role: roleName,
          adminModules: user.adminModules,
          adminNotificationAccess: user.adminNotificationAccess,
        },
        module
      )
    ) {
      continue;
    }

    const email = String(user.email || '').trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);

    recipients.push({
      email: user.email,
      name: [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Team',
    });
  }

  return recipients;
}
