-- Add a shared submission-level public id to group multiple return items
-- under one customer-visible/admin-visible Return ID.

ALTER TABLE "ReturnRequest"
ADD COLUMN IF NOT EXISTS "submissionPublicId" TEXT;

UPDATE "ReturnRequest"
SET "submissionPublicId" = "publicId"
WHERE "submissionPublicId" IS NULL OR "submissionPublicId" = '';

ALTER TABLE "ReturnRequest"
ALTER COLUMN "submissionPublicId" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "ReturnRequest_submissionPublicId_idx"
ON "ReturnRequest"("submissionPublicId");
