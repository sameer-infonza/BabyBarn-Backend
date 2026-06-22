-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN "memberPriceSnapshot" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "CheckoutIntentLine" ADD COLUMN "memberPriceSnapshot" DOUBLE PRECISION;
