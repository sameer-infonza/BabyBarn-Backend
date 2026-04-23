import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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

export async function listAuditLogs(page = 1, limit = 50) {
  const skip = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    prisma.adminAuditLog.findMany({
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.adminAuditLog.count(),
  ]);
  return {
    logs: rows,
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
  };
}
