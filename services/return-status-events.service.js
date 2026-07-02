import { prisma } from '../lib/prisma.js';

export async function appendReturnStatusEvent(tx, {
  returnRequestId,
  fromStatus,
  toStatus,
  actorUserId = null,
  note = null,
}) {
  const client = tx ?? prisma;
  return client.returnStatusEvent.create({
    data: {
      returnRequestId,
      fromStatus: fromStatus ?? null,
      toStatus,
      actorUserId,
      note: note ? String(note).trim() : null,
    },
  });
}

/** Log a note on the timeline without changing return status (from = to). */
export async function appendReturnActionNote(tx, { returnRequestId, status, actorUserId, note }) {
  return appendReturnStatusEvent(tx, {
    returnRequestId,
    fromStatus: status,
    toStatus: status,
    actorUserId,
    note,
  });
}

export async function listReturnStatusEvents(returnRequestId) {
  const rows = await prisma.returnStatusEvent.findMany({
    where: { returnRequestId },
    orderBy: { createdAt: 'asc' },
  });
  const actorIds = [...new Set(rows.map((r) => r.actorUserId).filter(Boolean))];
  const actors =
    actorIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: {
            id: true,
            publicId: true,
            email: true,
            firstName: true,
            lastName: true,
            role: { select: { name: true } },
          },
        })
      : [];
  const actorById = new Map(actors.map((a) => [a.id, a]));
  return rows.map((r) => {
    const actor = r.actorUserId ? actorById.get(r.actorUserId) : null;
    return {
      id: r.publicId,
      fromStatus: r.fromStatus,
      toStatus: r.toStatus,
      note: r.note,
      createdAt: r.createdAt,
      actor: actor
        ? {
            id: actor.publicId,
            email: actor.email,
            firstName: actor.firstName,
            lastName: actor.lastName,
            role: actor.role?.name ?? null,
          }
        : null,
    };
  });
}
