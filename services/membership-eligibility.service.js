import { prisma } from '../lib/prisma.js';
import { AppError } from '../utils/error-handler.js';

/** Days before expiry when renewal checkout is allowed (env override). */
export function getAccessRenewalWindowDays() {
  const n = parseInt(process.env.ACCESS_RENEWAL_WINDOW_DAYS || '30', 10);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

function formatExpiryDate(date) {
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * @param {Date | null | undefined} accessMemberUntil
 */
export function evaluateMembershipEligibility(accessMemberUntil) {
  const renewalWindowDays = getAccessRenewalWindowDays();
  const now = new Date();

  if (!accessMemberUntil) {
    return {
      status: 'none',
      accessMemberActive: false,
      accessMemberUntil: null,
      canPurchase: true,
      canRenew: false,
      daysUntilExpiry: null,
      renewalWindowDays,
      message: null,
      renewalMessage: null,
      renewalOpensAt: null,
    };
  }

  const until = accessMemberUntil instanceof Date ? accessMemberUntil : new Date(accessMemberUntil);
  if (Number.isNaN(until.getTime())) {
    return {
      status: 'none',
      accessMemberActive: false,
      accessMemberUntil: null,
      canPurchase: true,
      canRenew: false,
      daysUntilExpiry: null,
      renewalWindowDays,
      message: null,
      renewalMessage: null,
      renewalOpensAt: null,
    };
  }

  const msLeft = until.getTime() - now.getTime();
  const daysUntilExpiry = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
  const untilIso = until.toISOString();

  if (msLeft <= 0) {
    return {
      status: 'expired',
      accessMemberActive: false,
      accessMemberUntil: untilIso,
      canPurchase: true,
      canRenew: true,
      daysUntilExpiry,
      renewalWindowDays,
      message: null,
      renewalMessage: null,
      renewalOpensAt: null,
    };
  }

  if (daysUntilExpiry <= renewalWindowDays) {
    return {
      status: 'expiring',
      accessMemberActive: true,
      accessMemberUntil: untilIso,
      canPurchase: false,
      canRenew: true,
      daysUntilExpiry,
      renewalWindowDays,
      message: null,
      renewalMessage: null,
      renewalOpensAt: null,
    };
  }

  const renewalOpensAt = new Date(until);
  renewalOpensAt.setUTCDate(renewalOpensAt.getUTCDate() - renewalWindowDays);

  return {
    status: 'active',
    accessMemberActive: true,
    accessMemberUntil: untilIso,
    canPurchase: false,
    canRenew: false,
    daysUntilExpiry,
    renewalWindowDays,
    message: 'You already have active ACCESS.',
    renewalMessage: `Renewal will be available within ${renewalWindowDays} days of your expiry date (${formatExpiryDate(until)}).`,
    renewalOpensAt: renewalOpensAt.toISOString(),
  };
}

export async function getMembershipEligibilityForUser(userPublicId) {
  const user = await prisma.user.findUnique({
    where: { publicId: userPublicId },
    select: { accessMemberUntil: true },
  });
  if (!user) {
    throw new AppError(401, 'Unauthorized');
  }
  return evaluateMembershipEligibility(user.accessMemberUntil);
}

/**
 * @param {string} userPublicId
 * @param {{ intent?: 'purchase' | 'renew', returnTo?: string }} opts
 */
export async function assertMembershipCheckoutAllowed(userPublicId, opts = {}) {
  const eligibility = await getMembershipEligibilityForUser(userPublicId);
  const returnPath =
    opts.returnTo && typeof opts.returnTo === 'string'
      ? opts.returnTo.trim().split('#')[0].split('?')[0]
      : null;
  const wantsRenew =
    opts.intent === 'renew' ||
    returnPath === '/dashboard/access/renew';

  if (wantsRenew) {
    if (!eligibility.canRenew) {
      const msg =
        eligibility.status === 'active'
          ? `${eligibility.message} ${eligibility.renewalMessage}`
          : eligibility.status === 'none'
            ? 'You do not have an ACCESS membership to renew yet.'
            : 'Renewal is not available for your membership right now.';
      throw new AppError(409, msg, 'MEMBERSHIP_RENEWAL_NOT_AVAILABLE', eligibility);
    }
    return { ...eligibility, checkoutIntent: 'renew' };
  }

  if (!eligibility.canPurchase) {
    let msg = eligibility.message || 'You already have active ACCESS.';
    if (eligibility.status === 'expiring') {
      msg = `You already have active ACCESS. You can renew now — your membership expires in ${eligibility.daysUntilExpiry} day${eligibility.daysUntilExpiry === 1 ? '' : 's'}.`;
      throw new AppError(409, msg, 'MEMBERSHIP_USE_RENEWAL', {
        ...eligibility,
        renewUrl: '/dashboard/access/renew',
      });
    }
    if (eligibility.status === 'active') {
      msg = `${eligibility.message} ${eligibility.renewalMessage}`;
    }
    throw new AppError(409, msg, 'MEMBERSHIP_ALREADY_ACTIVE', eligibility);
  }

  return { ...eligibility, checkoutIntent: 'purchase' };
}
