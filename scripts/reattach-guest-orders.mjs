/**
 * Re-attach guest-owned orders to the matching full-account member so they show
 * up in the member dashboard and the checkout success summary.
 *
 * Safe by design:
 *   - DRY-RUN by default. Pass --apply to write changes.
 *   - Only re-attaches an order when a full-account member exists whose email
 *     equals the order's contact email (email is unique, so the match is exact).
 *   - Genuine guest orders (no matching member) are left untouched.
 *   - Idempotent: orders already owned by the member are skipped.
 *   - Each order + its return requests are moved inside a single transaction.
 *
 * Usage:
 *   node scripts/reattach-guest-orders.mjs                      # dry-run, all
 *   node scripts/reattach-guest-orders.mjs --email=a@b.com      # dry-run, one email
 *   node scripts/reattach-guest-orders.mjs --order=ORD-123      # dry-run, one order
 *   node scripts/reattach-guest-orders.mjs --apply              # apply changes
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');

function getArg(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() : null;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

async function main() {
  const emailFilter = normalizeEmail(getArg('email'));
  const orderFilter = getArg('order');

  const guestOwned = { OR: [{ placedAsGuest: true }, { user: { isGuest: true } }] };
  const where = orderFilter
    ? { AND: [guestOwned, { OR: [{ orderNumber: orderFilter }, { publicId: orderFilter }] }] }
    : guestOwned;

  const orders = await prisma.order.findMany({
    where,
    select: {
      id: true,
      publicId: true,
      orderNumber: true,
      contactEmail: true,
      userId: true,
      placedAsGuest: true,
      user: { select: { email: true, isGuest: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  let moved = 0;
  let skipped = 0;
  let noMatch = 0;

  console.log(`${APPLY ? 'APPLYING' : 'DRY-RUN'} — ${orders.length} guest-owned order(s) to consider.\n`);

  for (const order of orders) {
    const contact = normalizeEmail(order.contactEmail) || normalizeEmail(order.user?.email);
    if (emailFilter && contact !== emailFilter) continue;

    const member = contact
      ? await prisma.user.findFirst({
          where: { email: contact, isGuest: false },
          select: { id: true, publicId: true, email: true },
        })
      : null;

    const label = order.orderNumber || order.publicId;

    if (!member) {
      noMatch += 1;
      continue;
    }
    if (member.id === order.userId && order.placedAsGuest === false) {
      skipped += 1;
      continue;
    }

    if (!APPLY) {
      console.log(
        `[dry-run] would re-attach order ${label} (contact=${contact}) -> member ${member.publicId} (${member.email})`
      );
      moved += 1;
      continue;
    }

    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: { userId: member.id, placedAsGuest: false },
      });
      // Move any return requests filed against this order so they stay consistent
      // with the new owner (usually none for a freshly placed order).
      await tx.returnRequest.updateMany({
        where: { orderId: order.id },
        data: { userId: member.id },
      });
    });

    console.log(`re-attached order ${label} (contact=${contact}) -> member ${member.publicId} (${member.email})`);
    moved += 1;
  }

  console.log(
    `\nSummary: ${moved} ${APPLY ? 're-attached' : 'would re-attach'}, ${skipped} already member-owned, ${noMatch} genuine guest.`
  );
  if (!APPLY && moved > 0) {
    console.log('\nRe-run with --apply to persist these changes.');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
