-- Order line pricing tier, pickup tracking, and bundled ACCESS on checkout

CREATE TYPE "OrderItemPricingTier" AS ENUM ('STANDARD', 'ACCESS');

ALTER TABLE "CheckoutIntent" ADD COLUMN "includeAccessMembership" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CheckoutIntent" ADD COLUMN "accessMembershipAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "CheckoutIntent" ADD COLUMN "membershipBabyName" TEXT;

ALTER TABLE "CheckoutIntentLine" ADD COLUMN "retailUnitPrice" DOUBLE PRECISION;
ALTER TABLE "CheckoutIntentLine" ADD COLUMN "pricingTier" "OrderItemPricingTier" NOT NULL DEFAULT 'STANDARD';

ALTER TABLE "Order" ADD COLUMN "accessMembershipIncluded" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Order" ADD COLUMN "membershipPaymentId" INTEGER;

ALTER TABLE "OrderItem" ADD COLUMN "pricingTier" "OrderItemPricingTier" NOT NULL DEFAULT 'STANDARD';
ALTER TABLE "OrderItem" ADD COLUMN "retailUnitPrice" DOUBLE PRECISION;
ALTER TABLE "OrderItem" ADD COLUMN "pickedQuantity" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OrderItem" ADD COLUMN "pickedAt" TIMESTAMP(3);
ALTER TABLE "OrderItem" ADD COLUMN "pickedByUserId" INTEGER;

CREATE INDEX "OrderItem_pickedByUserId_idx" ON "OrderItem"("pickedByUserId");

ALTER TABLE "Order" ADD CONSTRAINT "Order_membershipPaymentId_fkey" FOREIGN KEY ("membershipPaymentId") REFERENCES "MembershipPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_pickedByUserId_fkey" FOREIGN KEY ("pickedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
