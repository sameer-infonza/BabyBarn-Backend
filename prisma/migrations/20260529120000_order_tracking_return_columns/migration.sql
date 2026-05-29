-- Order columns referenced by Prisma schema but missing on some deployed databases.
ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "shippingTransactionId" TEXT,
  ADD COLUMN IF NOT EXISTS "returnShipmentId" TEXT,
  ADD COLUMN IF NOT EXISTS "returnLabelUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "returnTrackingNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "returnShippingCarrier" TEXT,
  ADD COLUMN IF NOT EXISTS "returnTransactionId" TEXT,
  ADD COLUMN IF NOT EXISTS "trackingStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "trackingStatusDetails" TEXT,
  ADD COLUMN IF NOT EXISTS "trackingStatusDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "trackingEta" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "trackingHistoryJson" JSONB;
