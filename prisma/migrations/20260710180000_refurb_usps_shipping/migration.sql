-- Refurb return USPS customer shipping + envelope linkage
ALTER TYPE "ReturnStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

ALTER TABLE "ReturnRequest" ADD COLUMN IF NOT EXISTS "customerShippingNote" TEXT;
ALTER TABLE "ReturnRequest" ADD COLUMN IF NOT EXISTS "customerShippingSubmittedAt" TIMESTAMP(3);
ALTER TABLE "ReturnRequest" ADD COLUMN IF NOT EXISTS "shipByDeadline" TIMESTAMP(3);
ALTER TABLE "ReturnRequest" ADD COLUMN IF NOT EXISTS "keepWaitingUntil" TIMESTAMP(3);

ALTER TABLE "ReturnPackageRequest" ADD COLUMN IF NOT EXISTS "returnRequestId" INTEGER;
ALTER TABLE "ReturnPackageRequest" ADD COLUMN IF NOT EXISTS "expectedDeliveryDate" TIMESTAMP(3);

DO $$ BEGIN
  ALTER TABLE "ReturnPackageRequest"
    ADD CONSTRAINT "ReturnPackageRequest_returnRequestId_fkey"
    FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "ReturnPackageRequest_returnRequestId_idx" ON "ReturnPackageRequest"("returnRequestId");
