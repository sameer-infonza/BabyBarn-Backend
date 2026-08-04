-- AlterTable
ALTER TABLE "ReturnRequest" ADD COLUMN IF NOT EXISTS "acceptedQuantity" INTEGER;
ALTER TABLE "ReturnRequest" ADD COLUMN IF NOT EXISTS "rejectedQuantity" INTEGER;
ALTER TABLE "ReturnRequest" ADD COLUMN IF NOT EXISTS "customerNotes" TEXT;
ALTER TABLE "ReturnRequest" ADD COLUMN IF NOT EXISTS "adminNotes" TEXT;
ALTER TABLE "ReturnRequest" ADD COLUMN IF NOT EXISTS "inspectorPhotoUrlsJson" JSONB;
ALTER TABLE "ReturnRequest" ADD COLUMN IF NOT EXISTS "disposition" TEXT;
ALTER TABLE "ReturnRequest" ADD COLUMN IF NOT EXISTS "dispositionQuantity" INTEGER;

-- Backfill customer notes from legacy notes where empty
UPDATE "ReturnRequest"
SET "customerNotes" = "notes"
WHERE "customerNotes" IS NULL
  AND "notes" IS NOT NULL
  AND TRIM("notes") <> '';

-- Backfill accepted qty for already-approved lines
UPDATE "ReturnRequest"
SET "acceptedQuantity" = "quantity",
    "rejectedQuantity" = 0
WHERE "status" = 'APPROVED'
  AND "acceptedQuantity" IS NULL;

-- Backfill rejected qty for already-rejected lines
UPDATE "ReturnRequest"
SET "rejectedQuantity" = "quantity",
    "acceptedQuantity" = 0
WHERE "status" = 'REJECTED'
  AND "rejectedQuantity" IS NULL;
