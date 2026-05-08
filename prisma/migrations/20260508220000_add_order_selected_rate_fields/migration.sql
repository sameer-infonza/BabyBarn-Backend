-- Add shipping-rate snapshot columns used by checkout order flow.
-- Keep IF NOT EXISTS so this migration is safe across environments with partial drift.
ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "selectedRateId" TEXT,
  ADD COLUMN IF NOT EXISTS "selectedRateProvider" TEXT,
  ADD COLUMN IF NOT EXISTS "selectedRateServiceLevel" TEXT,
  ADD COLUMN IF NOT EXISTS "selectedRateServiceToken" TEXT,
  ADD COLUMN IF NOT EXISTS "selectedRateAmount" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "selectedRateCurrency" TEXT,
  ADD COLUMN IF NOT EXISTS "selectedRateEstimatedDays" INTEGER,
  ADD COLUMN IF NOT EXISTS "shippingShipmentId" TEXT;
