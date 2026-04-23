-- Cancellation workflow + ADMIN_TEAM module restrictions
CREATE TYPE "CancellationReviewStatus" AS ENUM ('NONE', 'PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "Order" ADD COLUMN "cancellationReviewStatus" "CancellationReviewStatus" NOT NULL DEFAULT 'NONE';
ALTER TABLE "Order" ADD COLUMN "cancellationRequestedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "cancellationRequestReason" TEXT;
ALTER TABLE "Order" ADD COLUMN "cancellationReviewNote" TEXT;

CREATE INDEX "Order_cancellationReviewStatus_idx" ON "Order"("cancellationReviewStatus");

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "adminModules" JSONB;
