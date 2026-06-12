-- Refurbished workflow: extended statuses, questionnaire, inspection records, product lineage

CREATE TYPE "RefurbEligibilityDecision" AS ENUM ('PASS', 'FAIL', 'MANUAL_REVIEW');
CREATE TYPE "RefurbConditionGrade" AS ENUM ('A', 'B', 'C');

ALTER TYPE "ReturnStatus" ADD VALUE IF NOT EXISTS 'ELIGIBILITY_REVIEW';
ALTER TYPE "ReturnStatus" ADD VALUE IF NOT EXISTS 'ELIGIBILITY_REJECTED';
ALTER TYPE "ReturnStatus" ADD VALUE IF NOT EXISTS 'LABEL_GENERATED';
ALTER TYPE "ReturnStatus" ADD VALUE IF NOT EXISTS 'IN_TRANSIT';
ALTER TYPE "ReturnStatus" ADD VALUE IF NOT EXISTS 'INSPECTION_APPROVED';
ALTER TYPE "ReturnStatus" ADD VALUE IF NOT EXISTS 'INSPECTION_REJECTED';

ALTER TYPE "RefurbishmentJobStatus" ADD VALUE IF NOT EXISTS 'CLEANING';
ALTER TYPE "RefurbishmentJobStatus" ADD VALUE IF NOT EXISTS 'IRONING';
ALTER TYPE "RefurbishmentJobStatus" ADD VALUE IF NOT EXISTS 'REPAIR';

ALTER TABLE "ReturnRequest" ADD COLUMN IF NOT EXISTS "returnLabelUrl" TEXT;
ALTER TABLE "ReturnRequest" ADD COLUMN IF NOT EXISTS "returnTrackingNumber" TEXT;
ALTER TABLE "ReturnRequest" ADD COLUMN IF NOT EXISTS "returnShippingCarrier" TEXT;
ALTER TABLE "ReturnRequest" ADD COLUMN IF NOT EXISTS "returnShipmentId" TEXT;
ALTER TABLE "ReturnRequest" ADD COLUMN IF NOT EXISTS "returnTransactionId" TEXT;
ALTER TABLE "ReturnRequest" ADD COLUMN IF NOT EXISTS "labelGeneratedAt" TIMESTAMP(3);
ALTER TABLE "ReturnRequest" ADD COLUMN IF NOT EXISTS "receivedAt" TIMESTAMP(3);
ALTER TABLE "ReturnRequest" ADD COLUMN IF NOT EXISTS "inspectionApprovedAt" TIMESTAMP(3);

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "sourceProductId" INTEGER;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "conditionGrade" "RefurbConditionGrade";
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "refurbishedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Product_sourceProductId_idx" ON "Product"("sourceProductId");

ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "Product_sourceProductId_fkey";
ALTER TABLE "Product" ADD CONSTRAINT "Product_sourceProductId_fkey"
  FOREIGN KEY ("sourceProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "ReturnEligibilityQuestionnaire" (
  "id" SERIAL NOT NULL,
  "publicId" TEXT NOT NULL,
  "returnRequestId" INTEGER NOT NULL,
  "answersJson" JSONB NOT NULL,
  "photoUrlsJson" JSONB,
  "autoDecision" "RefurbEligibilityDecision" NOT NULL,
  "autoDecisionReasons" JSONB,
  "reviewedByUserId" INTEGER,
  "reviewedAt" TIMESTAMP(3),
  "reviewNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReturnEligibilityQuestionnaire_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ReturnEligibilityQuestionnaire_publicId_key" ON "ReturnEligibilityQuestionnaire"("publicId");
CREATE UNIQUE INDEX IF NOT EXISTS "ReturnEligibilityQuestionnaire_returnRequestId_key" ON "ReturnEligibilityQuestionnaire"("returnRequestId");
CREATE INDEX IF NOT EXISTS "ReturnEligibilityQuestionnaire_autoDecision_idx" ON "ReturnEligibilityQuestionnaire"("autoDecision");

ALTER TABLE "ReturnEligibilityQuestionnaire" DROP CONSTRAINT IF EXISTS "ReturnEligibilityQuestionnaire_returnRequestId_fkey";
ALTER TABLE "ReturnEligibilityQuestionnaire" ADD CONSTRAINT "ReturnEligibilityQuestionnaire_returnRequestId_fkey"
  FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReturnEligibilityQuestionnaire" DROP CONSTRAINT IF EXISTS "ReturnEligibilityQuestionnaire_reviewedByUserId_fkey";
ALTER TABLE "ReturnEligibilityQuestionnaire" ADD CONSTRAINT "ReturnEligibilityQuestionnaire_reviewedByUserId_fkey"
  FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "RefurbInspectionRecord" (
  "id" SERIAL NOT NULL,
  "publicId" TEXT NOT NULL,
  "returnRequestId" INTEGER,
  "refurbishmentJobId" INTEGER,
  "inspectorUserId" INTEGER,
  "grade" "RefurbConditionGrade",
  "notes" TEXT,
  "photoUrlsJson" JSONB,
  "tasksCompletedJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RefurbInspectionRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RefurbInspectionRecord_publicId_key" ON "RefurbInspectionRecord"("publicId");
CREATE INDEX IF NOT EXISTS "RefurbInspectionRecord_returnRequestId_idx" ON "RefurbInspectionRecord"("returnRequestId");
CREATE INDEX IF NOT EXISTS "RefurbInspectionRecord_refurbishmentJobId_idx" ON "RefurbInspectionRecord"("refurbishmentJobId");

ALTER TABLE "RefurbInspectionRecord" DROP CONSTRAINT IF EXISTS "RefurbInspectionRecord_returnRequestId_fkey";
ALTER TABLE "RefurbInspectionRecord" ADD CONSTRAINT "RefurbInspectionRecord_returnRequestId_fkey"
  FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RefurbInspectionRecord" DROP CONSTRAINT IF EXISTS "RefurbInspectionRecord_refurbishmentJobId_fkey";
ALTER TABLE "RefurbInspectionRecord" ADD CONSTRAINT "RefurbInspectionRecord_refurbishmentJobId_fkey"
  FOREIGN KEY ("refurbishmentJobId") REFERENCES "RefurbishmentJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RefurbInspectionRecord" DROP CONSTRAINT IF EXISTS "RefurbInspectionRecord_inspectorUserId_fkey";
ALTER TABLE "RefurbInspectionRecord" ADD CONSTRAINT "RefurbInspectionRecord_inspectorUserId_fkey"
  FOREIGN KEY ("inspectorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill sourceProductId for existing refurb listings
UPDATE "Product" p
SET "sourceProductId" = oi."productId"
FROM "ReturnRequest" rr
JOIN "OrderItem" oi ON rr."orderItemId" = oi."id"
WHERE p."sourceReturnId" = rr."id"
  AND p."productType" = 'REFURBISHED'
  AND p."sourceProductId" IS NULL;
