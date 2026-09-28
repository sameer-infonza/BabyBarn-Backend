ALTER TABLE "CheckoutIntent" ADD COLUMN "sharedAccessOwnerId" INTEGER;
ALTER TABLE "CheckoutIntent" ADD COLUMN "sharedAccessNumber" TEXT;
ALTER TABLE "CheckoutIntent" ADD COLUMN "sharedAccessDiscount" DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE "Order" ADD COLUMN "sharedAccessOwnerId" INTEGER;
ALTER TABLE "Order" ADD COLUMN "sharedAccessNumber" TEXT;
ALTER TABLE "Order" ADD COLUMN "sharedAccessDiscount" DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE "BusinessSettings" ADD COLUMN "membershipSharingEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "BusinessSettings" ADD COLUMN "membershipShareMaxUsers" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BusinessSettings" ADD COLUMN "membershipShareMaxPerDay" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BusinessSettings" ADD COLUMN "membershipShareMaxPerMonth" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BusinessSettings" ADD COLUMN "membershipShareMaxPerYear" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Order" ADD CONSTRAINT "Order_sharedAccessOwnerId_fkey" FOREIGN KEY ("sharedAccessOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Order_sharedAccessOwnerId_idx" ON "Order"("sharedAccessOwnerId");
