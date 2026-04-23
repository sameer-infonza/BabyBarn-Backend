-- Runs after returns/wallet tables exist (fixes mis-ordered migration `20260421210339_new`).

DROP INDEX IF EXISTS "Category_name_key";
DROP INDEX IF EXISTS "Category_slug_key";

ALTER TABLE "ReturnRequest" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "StoreCreditWallet" ALTER COLUMN "updatedAt" DROP DEFAULT;
