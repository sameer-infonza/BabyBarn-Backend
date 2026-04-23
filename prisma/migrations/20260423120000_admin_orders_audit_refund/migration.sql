-- OrderPaymentStatus: REFUNDED
DO $$ BEGIN
  ALTER TYPE "OrderPaymentStatus" ADD VALUE 'REFUNDED';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "shippingLabelUrl" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "AdminAuditLog" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AdminAuditLog_publicId_key" ON "AdminAuditLog"("publicId");
CREATE INDEX IF NOT EXISTS "AdminAuditLog_entityType_entityId_idx" ON "AdminAuditLog"("entityType", "entityId");
CREATE INDEX IF NOT EXISTS "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt");
