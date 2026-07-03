import { prisma } from '../lib/prisma.js';

function hasFlag(flag) {
  return process.argv.includes(flag);
}

async function countMissingSubmissionIds() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS count
    FROM "ReturnRequest"
    WHERE "submissionPublicId" IS NULL OR "submissionPublicId" = ''
  `);
  return Number(rows?.[0]?.count ?? 0);
}

async function main() {
  const dryRun = hasFlag('--dry-run');

  const totalBefore = await prisma.returnRequest.count();
  const missingBefore = await countMissingSubmissionIds();

  console.log(`[returns-backfill] total rows: ${totalBefore}`);
  console.log(`[returns-backfill] rows missing submissionPublicId before: ${missingBefore}`);

  if (dryRun) {
    console.log('[returns-backfill] dry run only, no changes applied.');
    return;
  }

  const updated = await prisma.$executeRawUnsafe(`
    UPDATE "ReturnRequest"
    SET "submissionPublicId" = "publicId"
    WHERE "submissionPublicId" IS NULL OR "submissionPublicId" = ''
  `);

  const totalAfter = await prisma.returnRequest.count();
  const missingAfter = await countMissingSubmissionIds();

  console.log(`[returns-backfill] rows updated: ${updated}`);
  console.log(`[returns-backfill] total rows after: ${totalAfter}`);
  console.log(`[returns-backfill] rows missing submissionPublicId after: ${missingAfter}`);

  if (totalBefore !== totalAfter) {
    throw new Error(
      `ReturnRequest row count changed unexpectedly (${totalBefore} -> ${totalAfter}). Aborting for safety.`
    );
  }

  if (missingAfter !== 0) {
    throw new Error(`Backfill incomplete: ${missingAfter} rows still missing submissionPublicId.`);
  }

  console.log('[returns-backfill] backfill completed safely. Existing live return data was preserved.');
}

main()
  .catch((error) => {
    console.error('[returns-backfill] failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
