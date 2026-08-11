-- Idempotent store-credit earn keys (WAL-001). Unique when non-null.
ALTER TABLE "StoreCreditTransaction" ADD COLUMN IF NOT EXISTS "sourceKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "StoreCreditTransaction_sourceKey_key" ON "StoreCreditTransaction"("sourceKey");
