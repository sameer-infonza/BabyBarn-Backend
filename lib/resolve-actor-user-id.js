import { prisma } from './prisma.js';

/** Map JWT/API actor (publicId string) to internal User.id for FK columns. */
export async function resolveActorUserId(actor) {
  if (!actor?.id) return null;
  if (typeof actor.id === 'number') return actor.id;
  const user = await prisma.user.findUnique({
    where: { publicId: String(actor.id) },
    select: { id: true },
  });
  return user?.id ?? null;
}
