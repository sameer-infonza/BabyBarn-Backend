import { prisma } from '../lib/prisma.js';
import { AppError } from '../utils/error-handler.js';
import { getBusinessSettings } from './admin.service.js';
import { emailService } from './email.service.js';
import { config } from '../config/env.js';

const membershipAddressSchema = {
  fullName: (v) => typeof v === 'string' && v.trim().length >= 1,
  addressLine1: (v) => typeof v === 'string' && v.trim().length >= 1,
  city: (v) => typeof v === 'string' && v.trim().length >= 1,
  state: (v) => typeof v === 'string' && v.trim().length >= 1,
  zipCode: (v) => typeof v === 'string' && v.trim().length >= 1,
  country: (v) => typeof v === 'string' && v.trim().length >= 1,
};

export function validateMembershipRegistration(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new AppError(400, 'Registration details are required');
  }
  const babyName = String(payload.babyName || '').trim();
  if (!babyName) throw new AppError(400, 'Baby name is required');

  const ship = payload.shippingAddress;
  if (!ship || typeof ship !== 'object') {
    throw new AppError(400, 'Membership shipping address is required');
  }
  for (const [key, check] of Object.entries(membershipAddressSchema)) {
    if (!check(ship[key])) {
      throw new AppError(400, `Invalid shipping address: ${key}`);
    }
  }

  return {
    babyName,
    shippingAddress: {
      fullName: String(ship.fullName || babyName).trim(),
      addressLine1: ship.addressLine1.trim(),
      addressLine2: ship.addressLine2?.trim() || null,
      city: ship.city.trim(),
      state: ship.state.trim(),
      zipCode: ship.zipCode.trim(),
      country: ship.country.trim() || 'US',
      phoneNumber: ship.phoneNumber?.trim() || null,
    },
  };
}

export async function getPublicBusinessSettings() {
  const settings = await getBusinessSettings();
  return {
    accessMembershipPriceUsd: settings.accessMembershipPriceUsd,
    accessMembershipPriceLabel: `$${Number(settings.accessMembershipPriceUsd).toFixed(0)}`,
  };
}

async function generateUniqueAccessNumber() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const n = Math.floor(10000 + Math.random() * 90000);
    const accessNumber = `BB-${n}`;
    const exists = await prisma.user.findFirst({
      where: { accessNumber },
      select: { id: true },
    });
    if (!exists) return accessNumber;
  }
  throw new AppError(500, 'Could not generate ACCESS number');
}

export async function saveMembershipRegistration(userPublicId, payload) {
  const data = validateMembershipRegistration(payload);
  const user = await prisma.user.findUnique({
    where: { publicId: userPublicId },
    select: { id: true, email: true },
  });
  if (!user) throw new AppError(401, 'Unauthorized');

  await prisma.user.update({
    where: { id: user.id },
    data: {
      babyName: data.babyName,
      membershipShippingAddressJson: data.shippingAddress,
    },
  });

  return { saved: true };
}

export async function completeMembershipPayment(session) {
  const userPublicId = session.metadata?.userPublicId;
  if (!userPublicId) return { handled: true, error: 'missing userPublicId' };

  const amountUsd =
    typeof session.amount_total === 'number' ? session.amount_total / 100 : null;
  const sessionId = session.id;

  const existingPayment = await prisma.membershipPayment.findFirst({
    where: { stripeSessionId: sessionId },
  });
  if (existingPayment) {
    return { handled: true, flow: 'membership', duplicate: true };
  }

  const days = parseInt(process.env.ACCESS_MEMBERSHIP_DAYS || '365', 10);
  const user = await prisma.user.findUnique({
    where: { publicId: userPublicId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      accessNumber: true,
      accessMemberUntil: true,
      babyName: true,
    },
  });
  if (!user) return { handled: true, error: 'missing user' };

  const now = new Date();
  const wasActive = user.accessMemberUntil && user.accessMemberUntil > now;
  const base =
    user.accessMemberUntil && user.accessMemberUntil > now
      ? new Date(user.accessMemberUntil)
      : now;
  const until = new Date(base);
  until.setUTCDate(until.getUTCDate() + days);

  const accessNumber = user.accessNumber || (await generateUniqueAccessNumber());
  const paymentType = wasActive ? 'RENEWAL' : 'PURCHASE';

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        accessMemberUntil: until,
        accessNumber,
        accessRenewalReminderSentAt: null,
        ...(typeof session.customer === 'string' ? { stripeCustomerId: session.customer } : {}),
      },
    }),
    prisma.membershipPayment.create({
      data: {
        userId: user.id,
        type: paymentType,
        amount: amountUsd ?? (await getBusinessSettings()).accessMembershipPriceUsd,
        stripeSessionId: sessionId,
        accessValidUntil: until,
      },
    }),
  ]);

  const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'there';
  const dashboardUrl = `${config.frontend.customerUrl}/dashboard/access`;
  const template = paymentType === 'RENEWAL' ? 'access-renewal' : 'access-purchase';

  try {
    await emailService.sendTemplate({
      to: user.email,
      template,
      context: {
        name,
        accessNumber,
        amount: `$${Number(amountUsd ?? 50).toFixed(2)}`,
        validUntil: until.toLocaleDateString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        }),
        actionUrl: dashboardUrl,
      },
    });
  } catch (err) {
    console.error('[membership] email failed', err);
  }

  return { handled: true, flow: 'membership', paymentType, accessNumber };
}

/** ACCESS purchased in the same payment as an order checkout intent. */
export async function completeMembershipFromBundledCheckout({
  userId,
  userPublicId,
  amountUsd,
  stripeReferenceId,
  babyName,
  shippingAddress,
}) {
  const ref = String(stripeReferenceId || '').trim();
  if (ref) {
    const existingPayment = await prisma.membershipPayment.findFirst({
      where: { stripeSessionId: ref },
    });
    if (existingPayment) return existingPayment;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      accessNumber: true,
      accessMemberUntil: true,
      babyName: true,
    },
  });
  if (!user) return null;

  if (babyName || shippingAddress) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(babyName ? { babyName: String(babyName).trim() } : {}),
        ...(shippingAddress ? { membershipShippingAddressJson: shippingAddress } : {}),
      },
    });
  }

  const days = parseInt(process.env.ACCESS_MEMBERSHIP_DAYS || '365', 10);
  const now = new Date();
  const wasActive = user.accessMemberUntil && user.accessMemberUntil > now;
  const base =
    user.accessMemberUntil && user.accessMemberUntil > now
      ? new Date(user.accessMemberUntil)
      : now;
  const until = new Date(base);
  until.setUTCDate(until.getUTCDate() + days);

  const accessNumber = user.accessNumber || (await generateUniqueAccessNumber());
  const paymentType = wasActive ? 'RENEWAL' : 'PURCHASE';
  const settings = await getBusinessSettings();

  const membershipPayment = await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        accessMemberUntil: until,
        accessNumber,
        accessRenewalReminderSentAt: null,
      },
    });
    return tx.membershipPayment.create({
      data: {
        userId: user.id,
        type: paymentType,
        amount: amountUsd > 0 ? amountUsd : settings.accessMembershipPriceUsd,
        stripeSessionId: ref || null,
        accessValidUntil: until,
      },
    });
  });

  const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'there';
  try {
    await emailService.sendTemplate({
      to: user.email,
      template: paymentType === 'RENEWAL' ? 'access-renewal' : 'access-purchase',
      context: {
        name,
        accessNumber,
        amount: `$${Number(membershipPayment.amount).toFixed(2)}`,
        validUntil: until.toLocaleDateString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        }),
        actionUrl: `${config.frontend.customerUrl}/dashboard/access`,
      },
    });
  } catch (err) {
    console.error('[membership] bundled checkout email failed', err);
  }

  return membershipPayment;
}

export async function listMembershipPaymentsForUser(userPublicId) {
  const user = await prisma.user.findUnique({
    where: { publicId: userPublicId },
    select: { id: true, accessNumber: true, accessMemberUntil: true, createdAt: true },
  });
  if (!user) throw new AppError(401, 'Unauthorized');

  const payments = await prisma.membershipPayment.findMany({
    where: { userId: user.id },
    orderBy: { paidAt: 'desc' },
    take: 50,
  });

  return {
    accessNumber: user.accessNumber,
    accessMemberUntil: user.accessMemberUntil,
    memberSince: user.createdAt,
    payments: payments.map((p) => ({
      id: p.publicId,
      type: p.type,
      amount: p.amount,
      currency: p.currency,
      paidAt: p.paidAt,
      accessValidUntil: p.accessValidUntil,
      stripeSessionId: p.stripeSessionId,
    })),
  };
}

export async function getAccessSavingsForUser(userPublicId) {
  const user = await prisma.user.findUnique({
    where: { publicId: userPublicId },
    select: { id: true, accessMemberUntil: true },
  });
  if (!user) throw new AppError(401, 'Unauthorized');

  const hasAccess = user.accessMemberUntil != null && user.accessMemberUntil > new Date();

  const wallet = await prisma.storeCreditWallet.findUnique({
    where: { userId: user.id },
    select: {
      balance: true,
      heldBalance: true,
      transactions: {
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: { type: true, amount: true, note: true, createdAt: true },
      },
    },
  });

  const storeCreditBalance = Math.round(Number(wallet?.balance ?? 0) * 100) / 100;
  const storeCreditEarned =
    Math.round(
      (wallet?.transactions ?? [])
        .filter((t) => t.type === 'EARNED')
        .reduce((sum, t) => sum + Number(t.amount), 0) * 100
    ) / 100;
  const storeCreditRedeemed =
    Math.round(
      (wallet?.transactions ?? [])
        .filter((t) => t.type === 'REDEEMED')
        .reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0) * 100
    ) / 100;
  const recentCredits = (wallet?.transactions ?? [])
    .filter((t) => t.type === 'EARNED')
    .slice(0, 10)
    .map((t) => ({
      amount: Math.round(Number(t.amount) * 100) / 100,
      note: t.note ?? 'Store credit',
      createdAt: t.createdAt,
    }));

  if (!hasAccess) {
    return {
      savingsTotal: 0,
      orderCount: 0,
      channels: [],
      storeCreditBalance,
      storeCreditEarned,
      storeCreditRedeemed,
      recentCredits,
    };
  }

  const items = await prisma.orderItem.findMany({
    where: {
      order: {
        userId: user.id,
        paymentStatus: 'PAID',
        status: { notIn: ['CANCELLED'] },
      },
    },
    include: {
      product: {
        select: {
          price: true,
          memberPrice: true,
          productType: true,
        },
      },
    },
    take: 500,
  });

  let savingsTotal = 0;
  let memberPricingSavings = 0;
  const orderIds = new Set();

  for (const item of items) {
    const paid = Number(item.price);
    const retail = Number(item.product?.price ?? paid);
    const member = Number(item.product?.memberPrice ?? paid);
    const baseline = Math.max(retail, member);
    if (baseline > paid) {
      const saved = (baseline - paid) * item.quantity;
      savingsTotal += saved;
      memberPricingSavings += saved;
    }
    orderIds.add(item.orderId);
  }

  const memberPricingSavingsRounded = Math.round(memberPricingSavings * 100) / 100;

  return {
    savingsTotal: Math.round((savingsTotal + storeCreditEarned) * 100) / 100,
    memberPricingSavings: memberPricingSavingsRounded,
    orderCount: orderIds.size,
    channels: [
      {
        label: 'Member pricing',
        amount: memberPricingSavingsRounded,
      },
      {
        label: 'Store credit earned',
        amount: storeCreditEarned,
      },
    ],
    storeCreditBalance,
    storeCreditEarned,
    storeCreditRedeemed,
    recentCredits,
  };
}

export async function getMembershipRevenueStats({ dateFrom, dateTo } = {}) {
  const where = {};
  if (dateFrom || dateTo) {
    where.paidAt = {};
    if (dateFrom) where.paidAt.gte = new Date(dateFrom);
    if (dateTo) {
      const e = new Date(dateTo);
      e.setHours(23, 59, 59, 999);
      where.paidAt.lte = e;
    }
  }

  const agg = await prisma.membershipPayment.aggregate({
    where,
    _sum: { amount: true },
    _count: true,
  });

  return {
    membershipRevenue: agg._sum.amount ?? 0,
    membershipPaymentCount: agg._count,
  };
}

/** Send renewal reminders ~12 days before expiry (once per term). */
export async function sendAccessRenewalReminders() {
  const now = new Date();
  const in12 = new Date(now);
  in12.setUTCDate(in12.getUTCDate() + 12);
  const in13 = new Date(now);
  in13.setUTCDate(in13.getUTCDate() + 13);

  const users = await prisma.user.findMany({
    where: {
      accessMemberUntil: { gt: now, gte: in12, lt: in13 },
      accessRenewalReminderSentAt: null,
      accessNumber: { not: null },
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      accessNumber: true,
      accessMemberUntil: true,
    },
    take: 100,
  });

  let sent = 0;
  for (const user of users) {
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'there';
    try {
      await emailService.sendTemplate({
        to: user.email,
        template: 'access-renewal-reminder',
        context: {
          name,
          accessNumber: user.accessNumber,
          validUntil: user.accessMemberUntil.toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          }),
          actionUrl: `${config.frontend.customerUrl}/dashboard/access/renew`,
        },
      });
      await prisma.user.update({
        where: { id: user.id },
        data: { accessRenewalReminderSentAt: now },
      });
      sent += 1;
    } catch (err) {
      console.error('[membership] renewal reminder failed', user.email, err);
    }
  }

  return { sent, checked: users.length };
}

/** Notify members whose ACCESS expired in the last 24h (once). */
export async function sendAccessExpiredNotices() {
  const now = new Date();
  const dayAgo = new Date(now);
  dayAgo.setUTCDate(dayAgo.getUTCDate() - 1);

  const users = await prisma.user.findMany({
    where: {
      accessMemberUntil: { lte: now, gte: dayAgo },
      accessNumber: { not: null },
      accessExpiredNoticeSentAt: null,
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      accessMemberUntil: true,
    },
    take: 100,
  });

  let sent = 0;
  for (const user of users) {
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'there';
    try {
      await emailService.sendTemplate({
        to: user.email,
        template: 'access-expired',
        context: {
          name,
          validUntil: user.accessMemberUntil.toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          }),
          actionUrl: `${config.frontend.customerUrl}/access`,
        },
      });
      await prisma.user.update({
        where: { id: user.id },
        data: { accessExpiredNoticeSentAt: now },
      });
      sent += 1;
    } catch (err) {
      console.error('[membership] access expired notice failed', user.email, err);
    }
  }

  return { sent, checked: users.length };
}
