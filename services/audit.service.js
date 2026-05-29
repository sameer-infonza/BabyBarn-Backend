import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function buildAuditWhere(filters = {}) {
  const and = [];
  const search = filters.search ? String(filters.search).trim() : '';
  if (search) {
    and.push({
      OR: [
        { actorEmail: { contains: search, mode: 'insensitive' } },
        { action: { contains: search, mode: 'insensitive' } },
        { entityType: { contains: search, mode: 'insensitive' } },
        { entityId: { contains: search, mode: 'insensitive' } },
      ],
    });
  }
  if (filters.action) {
    and.push({ action: { equals: String(filters.action), mode: 'insensitive' } });
  }
  if (filters.entityType) {
    and.push({ entityType: { equals: String(filters.entityType), mode: 'insensitive' } });
  }
  if (filters.actorEmail) {
    and.push({ actorEmail: { contains: String(filters.actorEmail), mode: 'insensitive' } });
  }
  if (filters.dateFrom) {
    const from = new Date(String(filters.dateFrom));
    if (!Number.isNaN(from.getTime())) and.push({ createdAt: { gte: from } });
  }
  if (filters.dateTo) {
    const to = new Date(String(filters.dateTo));
    if (!Number.isNaN(to.getTime())) {
      to.setHours(23, 59, 59, 999);
      and.push({ createdAt: { lte: to } });
    }
  }
  return and.length ? { AND: and } : {};
}

export async function writeAdminAudit({ actorId, actorEmail, action, entityType, entityId, meta }) {
  try {
    await prisma.adminAuditLog.create({
      data: {
        actorId: actorId ?? null,
        actorEmail: actorEmail ?? null,
        action,
        entityType,
        entityId: String(entityId),
        meta: meta ?? undefined,
      },
    });
  } catch (e) {
    console.error('[audit] write failed', action, e);
  }
}

export async function listAuditLogs(page = 1, limit = 50, filters = {}) {
  const skip = (page - 1) * limit;
  const where = buildAuditWhere(filters);
  const [rows, total] = await Promise.all([
    prisma.adminAuditLog.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.adminAuditLog.count({ where }),
  ]);
  return {
    logs: rows,
    pagination: { total, page, limit, pages: Math.max(1, Math.ceil(total / limit) || 1) },
  };
}

export async function exportAuditLogs(filters = {}, limit = 5000) {
  const where = buildAuditWhere(filters);
  return prisma.adminAuditLog.findMany({
    where,
    take: Math.min(limit, 10000),
    orderBy: { createdAt: 'desc' },
  });
}

export function auditLogsToCsv(rows) {
  const header = ['createdAt', 'actorEmail', 'action', 'entityType', 'entityId', 'meta'];
  const escape = (value) => {
    const s = value == null ? '' : String(value);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = rows.map((row) =>
    [
      row.createdAt?.toISOString?.() ?? row.createdAt,
      row.actorEmail ?? '',
      row.action,
      row.entityType,
      row.entityId,
      row.meta != null ? JSON.stringify(row.meta) : '',
    ]
      .map(escape)
      .join(',')
  );
  return [header.join(','), ...lines].join('\r\n');
}
