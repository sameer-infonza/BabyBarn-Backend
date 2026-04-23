-- Enums
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'CONFIRMED';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'RETURNED';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'REFUNDED';

CREATE TYPE "ReturnType" AS ENUM ('STANDARD', 'REFURBISHMENT');
CREATE TYPE "ReturnStatus" AS ENUM ('REQUESTED', 'RECEIVED', 'UNDER_INSPECTION', 'APPROVED', 'REJECTED');
CREATE TYPE "StoreCreditTxnType" AS ENUM ('EARNED', 'REDEEMED', 'ADJUSTED');

-- Order shipping/tracking fields
ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "shippingCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "shippingAddressJson" JSONB,
  ADD COLUMN IF NOT EXISTS "shippingCarrier" TEXT,
  ADD COLUMN IF NOT EXISTS "trackingNumber" TEXT;

-- Store credit wallet
CREATE TABLE IF NOT EXISTS "StoreCreditWallet" (
  "id" SERIAL PRIMARY KEY,
  "publicId" TEXT NOT NULL UNIQUE,
  "userId" INTEGER NOT NULL UNIQUE,
  "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "StoreCreditWallet"
  ADD CONSTRAINT "StoreCreditWallet_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "StoreCreditTransaction" (
  "id" SERIAL PRIMARY KEY,
  "publicId" TEXT NOT NULL UNIQUE,
  "walletId" INTEGER NOT NULL,
  "type" "StoreCreditTxnType" NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "StoreCreditTransaction"
  ADD CONSTRAINT "StoreCreditTransaction_walletId_fkey"
  FOREIGN KEY ("walletId") REFERENCES "StoreCreditWallet"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "StoreCreditTransaction_walletId_idx" ON "StoreCreditTransaction"("walletId");
CREATE INDEX IF NOT EXISTS "StoreCreditTransaction_type_idx" ON "StoreCreditTransaction"("type");

-- Returns
CREATE TABLE IF NOT EXISTS "ReturnRequest" (
  "id" SERIAL PRIMARY KEY,
  "publicId" TEXT NOT NULL UNIQUE,
  "userId" INTEGER NOT NULL,
  "orderId" INTEGER NOT NULL,
  "orderItemId" INTEGER,
  "type" "ReturnType" NOT NULL DEFAULT 'STANDARD',
  "status" "ReturnStatus" NOT NULL DEFAULT 'REQUESTED',
  "reason" TEXT,
  "notes" TEXT,
  "creditAwarded" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "ReturnRequest"
  ADD CONSTRAINT "ReturnRequest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReturnRequest"
  ADD CONSTRAINT "ReturnRequest_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReturnRequest"
  ADD CONSTRAINT "ReturnRequest_orderItemId_fkey"
  FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "ReturnRequest_userId_idx" ON "ReturnRequest"("userId");
CREATE INDEX IF NOT EXISTS "ReturnRequest_orderId_idx" ON "ReturnRequest"("orderId");
CREATE INDEX IF NOT EXISTS "ReturnRequest_status_idx" ON "ReturnRequest"("status");
