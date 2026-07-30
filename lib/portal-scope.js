/**
 * Portal scope helpers — customer shop vs staff admin console.
 * Same email may exist once per scope (dual accounts).
 */

export const PORTAL_SCOPE = Object.freeze({
  CUSTOMER: 'CUSTOMER',
  STAFF: 'STAFF',
});

/** Request body portal values from customer-fe / admin-fe. */
export const LOGIN_PORTAL = Object.freeze({
  customer: 'customer',
  admin: 'admin',
});

const STAFF_ROLE_NAMES = new Set(['ADMIN', 'ADMIN_TEAM', 'VENDOR', 'SUPPORT', 'MANAGER']);

export function normalizeAuthEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/** Map FE `portal` query/body to PortalScope enum. */
export function portalToScope(portal) {
  const p = String(portal || '').trim().toLowerCase();
  if (p === LOGIN_PORTAL.admin || p === 'staff') return PORTAL_SCOPE.STAFF;
  return PORTAL_SCOPE.CUSTOMER;
}

export function otherPortalScope(portalScope) {
  return portalScope === PORTAL_SCOPE.STAFF ? PORTAL_SCOPE.CUSTOMER : PORTAL_SCOPE.STAFF;
}

export function isStaffRoleName(roleName) {
  return STAFF_ROLE_NAMES.has(String(roleName || ''));
}

export function portalScopeFromRoleName(roleName) {
  return isStaffRoleName(roleName) ? PORTAL_SCOPE.STAFF : PORTAL_SCOPE.CUSTOMER;
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} email
 * @param {'CUSTOMER'|'STAFF'} portalScope
 * @param {object} [opts]
 */
export async function findUserByEmailAndPortal(prisma, email, portalScope, opts = {}) {
  const normalized = normalizeAuthEmail(email);
  if (!normalized) return null;
  return prisma.user.findUnique({
    where: {
      email_portalScope: {
        email: normalized,
        portalScope,
      },
    },
    ...(opts.include ? { include: opts.include } : {}),
    ...(opts.select ? { select: opts.select } : {}),
  });
}
