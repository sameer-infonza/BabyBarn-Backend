#!/usr/bin/env node
/**
 * Manually send ACCESS membership reminder / expiry emails (same logic as the API timer jobs).
 *
 * Usage:
 *   node scripts/send-access-reminders.mjs
 *   node scripts/send-access-reminders.mjs --renewal-only
 *   node scripts/send-access-reminders.mjs --expired-only
 *   node scripts/send-access-reminders.mjs --dry-run
 *   node scripts/send-access-reminders.mjs --force --email demo@babyburn.local
 *
 * Env: ACCESS_RENEWAL_REMINDER_DAYS (default 14,0), SMTP_* or SENDGRID_* for delivery.
 */
import { prisma } from '../lib/prisma.js';
import { config } from '../config/env.js';
import {
  sendAccessRenewalReminders,
  sendAccessExpiredNotices,
} from '../services/membership.service.js';

const args = process.argv.slice(2);

function hasFlag(name) {
  return args.includes(name);
}

function flagValue(prefix) {
  const hit = args.find((a) => a.startsWith(`${prefix}=`));
  return hit ? hit.slice(prefix.length + 1).trim().toLowerCase() : null;
}

const dryRun = hasFlag('--dry-run');
const renewalOnly = hasFlag('--renewal-only');
const expiredOnly = hasFlag('--expired-only');
const force = hasFlag('--force');
const forceEmail = flagValue('--email');

const runRenewal = !expiredOnly || renewalOnly;
const runExpired = !renewalOnly || expiredOnly;
if (renewalOnly && expiredOnly) {
  console.error('[ERR] Use --renewal-only OR --expired-only, not both.');
  process.exit(1);
}

async function previewRenewalCandidates() {
  const now = new Date();
  const daysBeforeList = (config.accessRenewalReminderDays || [14, 0]).filter((d) => d >= 0);
  const rows = [];

  for (const daysBefore of daysBeforeList) {
    if (daysBefore === 0) {
      const dayStart = new Date(now);
      dayStart.setUTCHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

      const users = await prisma.user.findMany({
        where: {
          accessMemberUntil: { gte: dayStart, lt: dayEnd },
          accessExpiryDayReminderSentAt: force ? undefined : null,
          accessNumber: { not: null },
          ...(forceEmail ? { email: forceEmail } : {}),
        },
        select: {
          email: true,
          accessNumber: true,
          accessMemberUntil: true,
          accessRenewalReminderSentAt: true,
          accessExpiryDayReminderSentAt: true,
        },
        take: 100,
      });

      for (const u of users) {
        rows.push({
          kind: 'expiring-today',
          daysBefore: 0,
          email: u.email,
          accessNumber: u.accessNumber,
          accessMemberUntil: u.accessMemberUntil?.toISOString(),
        });
      }
      continue;
    }

    const windowStart = new Date(now);
    windowStart.setUTCDate(windowStart.getUTCDate() + daysBefore);
    const windowEnd = new Date(windowStart);
    windowEnd.setUTCDate(windowEnd.getUTCDate() + 1);

    const users = await prisma.user.findMany({
      where: {
        accessMemberUntil: { gt: now, gte: windowStart, lt: windowEnd },
        accessRenewalReminderSentAt: force ? undefined : null,
        accessNumber: { not: null },
        ...(forceEmail ? { email: forceEmail } : {}),
      },
      select: {
        email: true,
        accessNumber: true,
        accessMemberUntil: true,
        accessRenewalReminderSentAt: true,
      },
      take: 100,
    });

    for (const u of users) {
      rows.push({
        kind: 'renewal-soon',
        daysBefore,
        email: u.email,
        accessNumber: u.accessNumber,
        accessMemberUntil: u.accessMemberUntil?.toISOString(),
      });
    }
  }

  return rows;
}

async function previewExpiredCandidates() {
  const now = new Date();
  const dayAgo = new Date(now);
  dayAgo.setUTCDate(dayAgo.getUTCDate() - 1);

  const users = await prisma.user.findMany({
    where: {
      accessMemberUntil: { lte: now, gte: dayAgo },
      accessNumber: { not: null },
      accessExpiredNoticeSentAt: force ? undefined : null,
      ...(forceEmail ? { email: forceEmail } : {}),
    },
    select: {
      email: true,
      accessNumber: true,
      accessMemberUntil: true,
      accessExpiredNoticeSentAt: true,
    },
    take: 100,
  });

  return users.map((u) => ({
    kind: 'expired',
    email: u.email,
    accessNumber: u.accessNumber,
    accessMemberUntil: u.accessMemberUntil?.toISOString(),
  }));
}

async function resetReminderFlagsForEmail(email) {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true } });
  if (!user) {
    console.warn(`[WARN] No user found for --email=${email}`);
    return false;
  }
  await prisma.user.update({
    where: { id: user.id },
    data: {
      accessRenewalReminderSentAt: null,
      accessExpiryDayReminderSentAt: null,
      accessExpiredNoticeSentAt: null,
    },
  });
  console.log(`[OK] Cleared ACCESS reminder flags for ${email} (safe to resend).`);
  return true;
}

async function main() {
  console.log('');
  console.log('ACCESS membership email reminders');
  console.log(`  Reminder days (ACCESS_RENEWAL_REMINDER_DAYS): ${(config.accessRenewalReminderDays || [14, 0]).join(', ')}`);
  console.log(`  Customer URL: ${config.frontend.customerUrl}`);
  console.log(`  Mode: ${dryRun ? 'DRY RUN (no emails sent)' : 'LIVE SEND'}`);
  if (forceEmail) console.log(`  Filter email: ${forceEmail}`);
  if (force) console.log('  --force: will clear sent flags for target user(s) before send');
  console.log('');

  if (force && forceEmail) {
    await resetReminderFlagsForEmail(forceEmail);
  } else if (force && !forceEmail) {
    console.warn('[WARN] --force is most useful with --email=user@example.com to allow resend.');
  }

  if (dryRun) {
    if (runRenewal) {
      const renewalRows = await previewRenewalCandidates();
      console.log(`Renewal / expiring-soon candidates: ${renewalRows.length}`);
      for (const r of renewalRows) {
        console.log(
          `  • [${r.kind}] ${r.email} | ACCESS ${r.accessNumber} | expires ${r.accessMemberUntil} | daysBefore=${r.daysBefore}`
        );
      }
      if (renewalRows.length === 0) {
        console.log('  (none — adjust accessMemberUntil or use --force --email=... to retest)');
      }
    }

    if (runExpired) {
      const expiredRows = await previewExpiredCandidates();
      console.log(`\nExpired (last 24h) candidates: ${expiredRows.length}`);
      for (const r of expiredRows) {
        console.log(`  • [${r.kind}] ${r.email} | ACCESS ${r.accessNumber} | expired ${r.accessMemberUntil}`);
      }
      if (expiredRows.length === 0) {
        console.log('  (none — member must have expired within the past 24 hours)');
      }
    }

    console.log('\nRun without --dry-run to send emails.');
    return;
  }

  if (runRenewal) {
    const renewal = await sendAccessRenewalReminders();
    console.log(`[renewal] checked=${renewal.checked} sent=${renewal.sent}`);
  }

  if (runExpired) {
    const expired = await sendAccessExpiredNotices();
    console.log(`[expired] checked=${expired.checked} sent=${expired.sent}`);
  }

  console.log('\nDone.');
}

main()
  .catch((err) => {
    console.error('[ERR]', err?.message || err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
