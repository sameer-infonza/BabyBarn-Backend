import { PrismaClient, Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { AppError } from '../utils/error-handler.js';
import { normalizeTeamPermissionModules } from '../constants/admin-modules.js';
import { emailService } from './email.service.js';
import { writeAdminAudit } from './audit.service.js';
import { config } from '../config/env.js';

const prisma = new PrismaClient();

function isStorefrontCustomerRole(roleName) {
  return roleName === 'CUSTOMER' || roleName === 'USER';
}

function dateRangeWhere(dateFrom, dateTo) {
  const range = {};
  if (dateFrom) range.gte = new Date(dateFrom);
  if (dateTo) {
    const e = new Date(dateTo);
    e.setHours(23, 59, 59, 999);
    range.lte = e;
  }
  return Object.keys(range).length ? range : undefined;
}

export async function getFinanceStats({ dateFrom, dateTo } = {}) {
  const createdAt = dateRangeWhere(dateFrom, dateTo);
  const basePaid = {
    paymentStatus: 'PAID',
    status: { notIn: ['CANCELLED'] },
    ...(createdAt ? { createdAt } : {}),
  };

  const [totalAgg, refundedAgg, refurbishedRow] = await Promise.all([
    prisma.order.aggregate({
      where: basePaid,
      _sum: { totalAmount: true },
      _count: true,
    }),
    prisma.order.aggregate({
      where: {
        paymentStatus: 'REFUNDED',
        ...(createdAt ? { createdAt } : {}),
      },
      _sum: { totalAmount: true },
      _count: true,
    }),
    refurbishedSalesRaw(createdAt),
  ]);

  const now = new Date();
  const activeMembers = await prisma.user.count({
    where: {
      accessMemberUntil: { gt: now },
    },
  });

  return {
    totalRevenue: totalAgg._sum.totalAmount ?? 0,
    paidOrderCount: totalAgg._count,
    refurbishedSales: refurbishedRow,
    refundedTotal: refundedAgg._sum.totalAmount ?? 0,
    refundedOrderCount: refundedAgg._count,
    /** Membership checkout does not create Order rows; Stripe-only. */
    membershipRevenueInOrders: 0,
    membershipNote:
      'ACCESS membership is paid via Stripe Checkout; revenue is not stored in Order totals. Use Stripe reporting for membership income.',
    activeMembersCount: activeMembers,
  };
}

async function refurbishedSalesRaw(createdAt) {
  const gtePart = createdAt?.gte ? Prisma.sql`AND o."createdAt" >= ${createdAt.gte}` : Prisma.empty;
  const ltePart = createdAt?.lte ? Prisma.sql`AND o."createdAt" <= ${createdAt.lte}` : Prisma.empty;
  const rows = await prisma.$queryRaw`
    SELECT COALESCE(SUM(oi."price" * oi."quantity"), 0)::float AS "sum"
    FROM "OrderItem" oi
    INNER JOIN "Order" o ON oi."orderId" = o."id"
    INNER JOIN "Product" p ON oi."productId" = p."id"
    WHERE o."paymentStatus" = 'PAID'
      AND o."status" <> 'CANCELLED'
      AND p."productType" = 'REFURBISHED'
      ${gtePart}
      ${ltePart}
  `;
  return rows[0]?.sum ?? 0;
}

export async function listCustomers(page = 1, limit = 20, { search, role } = {}) {
  const skip = (page - 1) * limit;
  const and = [];
  if (role && String(role).trim()) {
    and.push({ role: { name: String(role).trim() } });
  } else {
    and.push({ role: { name: { in: ['CUSTOMER', 'USER'] } } });
  }
  if (search && String(search).trim()) {
    const q = String(search).trim();
    and.push({
      OR: [
        { email: { contains: q, mode: 'insensitive' } },
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
      ],
    });
  }
  const where = { AND: and };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        publicId: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        isActive: true,
        accessMemberUntil: true,
        createdAt: true,
        role: { select: { name: true } },
      },
    }),
    prisma.user.count({ where }),
  ]);

  return {
    customers: users,
    pagination: { total, page, limit, pages: Math.ceil(total / limit) || 1 },
  };
}

export async function getCustomerDetail(userPublicId) {
  const user = await prisma.user.findUnique({
    where: { publicId: userPublicId },
    select: {
      publicId: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      isActive: true,
      accessMemberUntil: true,
      createdAt: true,
      role: { select: { name: true } },
      storeCreditWallet: { select: { balance: true, publicId: true } },
    },
  });
  if (!user || !isStorefrontCustomerRole(user.role?.name)) {
    throw new AppError(404, 'Customer not found');
  }

  const uid = await prisma.user.findUnique({
    where: { publicId: userPublicId },
    select: { id: true },
  });

  const [orderAgg, orders, returns, cancellations] = await Promise.all([
    prisma.order.aggregate({
      where: { userId: uid.id, paymentStatus: 'PAID', status: { not: 'CANCELLED' } },
      _sum: { totalAmount: true },
      _count: true,
    }),
    prisma.order.findMany({
      where: { userId: uid.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        publicId: true,
        status: true,
        paymentStatus: true,
        totalAmount: true,
        createdAt: true,
      },
    }),
    prisma.returnRequest.findMany({
      where: { userId: uid.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        publicId: true,
        status: true,
        type: true,
        createdAt: true,
      },
    }),
    prisma.order.count({
      where: { userId: uid.id, status: 'CANCELLED' },
    }),
  ]);

  return {
    user,
    walletBalance: user.storeCreditWallet?.balance ?? 0,
    totalSpend: orderAgg._sum.totalAmount ?? 0,
    orderCount: orderAgg._count,
    orders,
    returns,
    cancellationsCount: cancellations,
  };
}

export async function setUserActive(userPublicId, isActive) {
  const user = await prisma.user.findUnique({
    where: { publicId: userPublicId },
    select: { id: true, role: { select: { name: true } } },
  });
  if (!user) throw new AppError(404, 'User not found');
  if (!isStorefrontCustomerRole(user.role?.name)) {
    throw new AppError(400, 'Only customer accounts can be activated/deactivated here');
  }
  return prisma.user.update({
    where: { id: user.id },
    data: { isActive: Boolean(isActive) },
    select: {
      publicId: true,
      email: true,
      isActive: true,
    },
  });
}

export async function listAccessMembers({ filter = 'all' } = {}) {
  const now = new Date();
  let where = {};
  if (filter === 'active') {
    where = { accessMemberUntil: { gt: now } };
  } else if (filter === 'expired') {
    where = { accessMemberUntil: { not: null, lte: now } };
  } else {
    where = { accessMemberUntil: { not: null } };
  }

  const users = await prisma.user.findMany({
    where,
    orderBy: { accessMemberUntil: 'desc' },
    select: {
      id: true,
      publicId: true,
      email: true,
      firstName: true,
      lastName: true,
      accessMemberUntil: true,
      createdAt: true,
    },
  });

  return { members: users };
}

export async function getBusinessSettings() {
  const row =
    (await prisma.businessSettings.findUnique({ where: { id: 1 } })) ||
    (await prisma.businessSettings.create({
      data: { id: 1, accessMembershipPriceUsd: 49 },
    }));
  return {
    accessMembershipPriceUsd: row.accessMembershipPriceUsd,
    updatedAt: row.updatedAt,
  };
}

export async function updateBusinessSettings({ accessMembershipPriceUsd }) {
  if (accessMembershipPriceUsd != null) {
    const n = Number(accessMembershipPriceUsd);
    if (Number.isNaN(n) || n < 0 || n > 99999) {
      throw new AppError(400, 'Invalid membership price');
    }
    await prisma.businessSettings.upsert({
      where: { id: 1 },
      create: { id: 1, accessMembershipPriceUsd: n },
      update: { accessMembershipPriceUsd: n },
    });
  }
  return getBusinessSettings();
}

async function assertActorIsAdmin(actorPublicId) {
  const actor = await prisma.user.findUnique({
    where: { publicId: actorPublicId },
    select: { role: { select: { name: true } } },
  });
  if (!actor || actor.role?.name !== 'ADMIN') {
    throw new AppError(403, 'Only super admins can manage team modules');
  }
}

export async function listAdminTeamMembers(actorPublicId) {
  void actorPublicId;
  const role = await prisma.role.findUnique({ where: { name: 'ADMIN_TEAM' } });
  if (!role) return { members: [] };
  const users = await prisma.user.findMany({
    where: { roleId: role.id },
    orderBy: { email: 'asc' },
    select: {
      publicId: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      adminModules: true,
      isActive: true,
      createdAt: true,
    },
  });
  return { members: users };
}

export async function createAdminTeamMember(actorPublicId, payload) {
  await assertActorIsAdmin(actorPublicId);
  const teamRole = await prisma.role.findUnique({ where: { name: 'ADMIN_TEAM' } });
  if (!teamRole) throw new AppError(500, 'ADMIN_TEAM role missing');

  const email = String(payload.email || '').trim().toLowerCase();
  const tempPassword = `Bb!${Math.random().toString(36).slice(2, 8)}${Math.floor(Math.random() * 90 + 10)}`;
  const firstName = payload.firstName ? String(payload.firstName).trim() : null;
  const lastName = payload.lastName ? String(payload.lastName).trim() : null;
  const roleTitle = payload.roleTitle ? String(payload.roleTitle).trim() : null;
  const modules = payload.modules;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new AppError(400, 'Email already registered');
  }

  const normalized = normalizeTeamPermissionModules(modules);

  const hashed = await bcrypt.hash(tempPassword, 10);
  const created = await prisma.user.create({
    data: {
      email,
      password: hashed,
      firstName,
      lastName,
      phone: roleTitle,
      roleId: teamRole.id,
      adminModules: normalized,
      emailVerifiedAt: new Date(),
      isActive: true,
    },
    select: {
      publicId: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      adminModules: true,
      isActive: true,
      createdAt: true,
    },
  });
  await writeAdminAudit({
    actorId: actorPublicId,
    action: 'TEAM_MEMBER_CREATED',
    entityType: 'User',
    entityId: created.publicId,
    meta: { modules: normalized, roleTitle },
  });
  try {
    await emailService.sendTemplate({
      to: created.email,
      template: 'team-invite',
      context: {
        name: [created.firstName, created.lastName].filter(Boolean).join(' ') || created.email,
        email: created.email,
        temporaryPassword: tempPassword,
        roleTitle: roleTitle || 'Team Member',
        loginUrl: `${config.frontend.adminUrl}/auth/login`,
      },
    });
  } catch (error) {
    await writeAdminAudit({
      actorId: actorPublicId,
      action: 'TEAM_INVITE_EMAIL_FAILED',
      entityType: 'User',
      entityId: created.publicId,
      meta: { error: String(error?.message || error) },
    });
  }
  return created;
}

export async function setTeamMemberModules(actorPublicId, targetPublicId, modules) {
  await assertActorIsAdmin(actorPublicId);
  const teamRole = await prisma.role.findUnique({ where: { name: 'ADMIN_TEAM' } });
  if (!teamRole) throw new AppError(500, 'ADMIN_TEAM role missing');

  const normalized = normalizeTeamPermissionModules(modules);

  const target = await prisma.user.findUnique({
    where: { publicId: targetPublicId },
    select: { id: true, roleId: true },
  });
  if (!target || target.roleId !== teamRole.id) {
    throw new AppError(404, 'Team member not found');
  }

  const updated = await prisma.user.update({
    where: { id: target.id },
    data: { adminModules: normalized },
    select: {
      publicId: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      adminModules: true,
      isActive: true,
      createdAt: true,
    },
  });
  await writeAdminAudit({
    actorId: actorPublicId,
    action: 'TEAM_MODULES_UPDATED',
    entityType: 'User',
    entityId: updated.publicId,
    meta: { modules: normalized },
  });
  return updated;
}

export async function updateTeamMember(actorPublicId, targetPublicId, payload) {
  await assertActorIsAdmin(actorPublicId);
  const teamRole = await prisma.role.findUnique({ where: { name: 'ADMIN_TEAM' } });
  if (!teamRole) throw new AppError(500, 'ADMIN_TEAM role missing');
  const target = await prisma.user.findUnique({
    where: { publicId: targetPublicId },
    select: { id: true, roleId: true, publicId: true },
  });
  if (!target || target.roleId !== teamRole.id) throw new AppError(404, 'Team member not found');

  const data = {};
  if (payload.roleTitle !== undefined) data.phone = payload.roleTitle ? String(payload.roleTitle).trim() : null;
  if (payload.isActive !== undefined) data.isActive = Boolean(payload.isActive);
  if (payload.modules !== undefined) data.adminModules = normalizeTeamPermissionModules(payload.modules);

  const updated = await prisma.user.update({
    where: { id: target.id },
    data,
    select: {
      publicId: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      adminModules: true,
      isActive: true,
      createdAt: true,
    },
  });
  await writeAdminAudit({
    actorId: actorPublicId,
    action: 'TEAM_MEMBER_UPDATED',
    entityType: 'User',
    entityId: updated.publicId,
    meta: {
      roleTitle: updated.phone || null,
      isActive: updated.isActive,
      modules: updated.adminModules,
    },
  });
  return updated;
}
