-- Per-line cancellation support + partial refund payment status.

ALTER TYPE "OrderPaymentStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_REFUNDED';

ALTER TABLE "OrderItem"
ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "cancellationReason" TEXT;

CREATE INDEX IF NOT EXISTS "OrderItem_cancelledAt_idx" ON "OrderItem"("cancelledAt");
