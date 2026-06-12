-- Guest checkout: guest user profiles and order contact fields
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isGuest" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "guestCreatedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "convertedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "User_isGuest_idx" ON "User"("isGuest");

ALTER TABLE "CheckoutIntent" ADD COLUMN IF NOT EXISTS "contactEmail" TEXT;
ALTER TABLE "CheckoutIntent" ADD COLUMN IF NOT EXISTS "placedAsGuest" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "contactEmail" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "contactPhone" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "placedAsGuest" BOOLEAN NOT NULL DEFAULT false;
