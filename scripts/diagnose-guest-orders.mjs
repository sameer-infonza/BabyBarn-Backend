/**
 * Diagnose orders that ended up owned by a guest identity even though a real
 * member account exists for the same email.
 *
 * Background: if a logged-in member somehow checked out under a guest /
 * checkout-scoped session, the order is created with `placedAsGuest = true` and
 * owned by a guest User row. The member dashboard and the checkout success
 * summary both filter strictly by `userId`, so the order becomes invisible to
 * the member.
 *
 * This script is READ-ONLY. It lists every guest-owned order and shows whether a
 * full-account member exists whose email matches the order's contact email
 * (the safe key to re-attach on). Use scripts/reattach-guest-orders.mjs to fix.
 *
 * Usage:
 *   node scripts/diagnose-guest-orders.mjs
 *   node scripts/diagnose-guest-orders.mjs --email=someone@example.com
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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

  const orders = await prisma.order.findMany({
    where: {
      OR: [{ placedAsGuest: true }, { user: { isGuest: true } }],
    },
    select: {
      publicId: true,
      orderNumber: true,
      contactEmail: true,
      placedAsGuest: true,
      totalAmount: true,
      paymentStatus: true,
      status: true,
      createdAt: true,
      userId: true,
      user: { select: { publicId: true, email: true, isGuest: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  let candidates = 0;
  let noMatch = 0;
  let alreadyOwnedByMember = 0;

  console.log(`Found ${orders.length} guest-owned order(s).\n`);

  for (const order of orders) {
    const contact = normalizeEmail(order.contactEmail) || normalizeEmail(order.user?.email);
    if (emailFilter && contact !== emailFilter) continue;

    // A full-account member whose email matches the order's contact email is the
    // safe re-attach target. Email is unique, so this match is unambiguous.
    const member = contact
      ? await prisma.user.findFirst({
          where: { email: contact, isGuest: false },
          select: { id: true, publicId: true, email: true },
        })
      : null;

    let verdict;
    if (member && member.id === order.userId) {
      verdict = 'OK (already owned by member)';
      alreadyOwnedByMember += 1;
    } else if (member) {
      verdict = `RE-ATTACH -> member ${member.publicId} (${member.email})`;
      candidates += 1;
    } else {
      verdict = 'genuine guest (no matching member) - leave as is';
      noMatch += 1;
    }

    console.log(
      [
        `order=${order.orderNumber || order.publicId}`,
        `created=${order.createdAt.toISOString()}`,
        `pay=${order.paymentStatus}/${order.status}`,
        `contact=${contact || '(none)'}`,
        `owner=${order.user?.email || '(none)'}${order.user?.isGuest ? ' [guest]' : ''}`,
        `=> ${verdict}`,
      ].join('  ')
    );
  }

  console.log(
    `\nSummary: ${candidates} re-attachable, ${alreadyOwnedByMember} already member-owned, ${noMatch} genuine guest.`
  );
  if (candidates > 0) {
    console.log('\nNext: dry-run the fix with');
    console.log('  node scripts/reattach-guest-orders.mjs');
    console.log('then apply with');
    console.log('  node scripts/reattach-guest-orders.mjs --apply');
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
